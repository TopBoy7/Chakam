#include <Arduino.h>
#include "CameraConfig.h"

// ── Static pin maps ────────────────────────────────────────────────────────────

CameraConfig::Pins CameraConfig::esp32S3WroomOV5640Pins()
{
    Pins p;
    p.pwdn  = -1;  p.reset = -1;
    p.xclk  = 15;
    p.sda   = 4;   p.scl   = 5;
    p.d7=16; p.d6=17; p.d5=18; p.d4=12;
    p.d3=10; p.d2=8;  p.d1=9;  p.d0=11;
    p.vsync = 6;   p.href  = 7;   p.pclk = 13;
    return p;
}

CameraConfig::Pins CameraConfig::esp32S3EyePins()
{
    Pins p;
    p.pwdn  = -1;  p.reset = -1;
    p.xclk  = 15;
    p.sda   = 4;   p.scl   = 5;
    p.d7=16; p.d6=17; p.d5=18; p.d4=12;
    p.d3=10; p.d2=8;  p.d1=9;  p.d0=11;
    p.vsync = 6;   p.href  = 7;   p.pclk = 13;
    return p;
}

// ── Constructor ────────────────────────────────────────────────────────────────

CameraConfig::CameraConfig(const Pins &pins,
                           pixformat_t pixelFormat,
                           framesize_t frameSize,
                           int jpegQuality,
                           int fbCount,
                           SensorModel expectedSensor)
    : _pins(pins),
      _pixelFormat(pixelFormat),
      _frameSize(frameSize),
      _jpegQuality(jpegQuality),
      _fbCount(fbCount),
      _expectedSensor(expectedSensor)
{}

// ── Private helpers ────────────────────────────────────────────────────────────

void CameraConfig::setError(const String &msg)
{
    _lastError = msg;
    Serial.println(msg);
}

camera_config_t CameraConfig::buildConfig() const
{
    camera_config_t cfg;
    cfg.pin_pwdn  = _pins.pwdn;
    cfg.pin_reset = _pins.reset;
    cfg.pin_xclk  = _pins.xclk;
    cfg.pin_sscb_sda = _pins.sda;
    cfg.pin_sscb_scl = _pins.scl;
    cfg.pin_d7 = _pins.d7; cfg.pin_d6 = _pins.d6;
    cfg.pin_d5 = _pins.d5; cfg.pin_d4 = _pins.d4;
    cfg.pin_d3 = _pins.d3; cfg.pin_d2 = _pins.d2;
    cfg.pin_d1 = _pins.d1; cfg.pin_d0 = _pins.d0;
    cfg.pin_vsync = _pins.vsync;
    cfg.pin_href  = _pins.href;
    cfg.pin_pclk  = _pins.pclk;
    cfg.xclk_freq_hz = 20000000;
    cfg.ledc_timer   = LEDC_TIMER_0;
    cfg.ledc_channel = LEDC_CHANNEL_0;
    cfg.pixel_format = _pixelFormat;
    cfg.frame_size   = _frameSize;
    cfg.jpeg_quality = _jpegQuality;
    cfg.fb_count     = _fbCount;
    cfg.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
    cfg.fb_location  = CAMERA_FB_IN_PSRAM;
    return cfg;
}

void CameraConfig::safeDeinit()
{
    if (_driverStarted) {
        esp_camera_deinit();
        _driverStarted = false;
    }
    _initialised = false;
}

bool CameraConfig::validateSensorModel()
{
    if (_expectedSensor == SensorModel::Any) return true;

    sensor_t *s = esp_camera_sensor_get();
    if (!s) { setError("Cannot read sensor PID"); return false; }

    _sensorPid = s->id.PID;
    uint16_t expected = (_expectedSensor == SensorModel::OV5640) ? OV5640_PID : OV2640_PID;

    if (_sensorPid != expected) {
        String msg = "Sensor mismatch: expected ";
        msg += sensorModelName(_expectedSensor);
        msg += " (0x"; msg += String(expected, HEX);
        msg += ") but got 0x"; msg += String(_sensorPid, HEX);
        setError(msg);
        return false;
    }
    return true;
}

const char *CameraConfig::sensorModelName(SensorModel model)
{
    switch (model) {
        case SensorModel::OV2640: return "OV2640";
        case SensorModel::OV5640: return "OV5640";
        default:                  return "Any";
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

bool CameraConfig::begin()
{
    safeDeinit();

    camera_config_t cfg = buildConfig();
    esp_err_t err = esp_camera_init(&cfg);
    if (err != ESP_OK) {
        String msg = "esp_camera_init failed: 0x";
        msg += String(err, HEX);
        setError(msg);
        return false;
    }
    _driverStarted = true;

    if (!validateSensorModel()) {
        safeDeinit();
        return false;
    }

    // Cache PID even when SensorModel::Any
    sensor_t *s = esp_camera_sensor_get();
    if (s) _sensorPid = s->id.PID;

    _initialised = true;
    return true;
}

void CameraConfig::end()  { safeDeinit(); }

camera_fb_t *CameraConfig::captureFrame()
{
    if (!_initialised) { setError("Camera not initialised"); return nullptr; }
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) setError("esp_camera_fb_get() returned null");
    return fb;
}

void CameraConfig::releaseFrame(camera_fb_t *frame)
{
    if (frame) esp_camera_fb_return(frame);
}

sensor_t *CameraConfig::sensor() const
{
    return _initialised ? esp_camera_sensor_get() : nullptr;
}

bool CameraConfig::setFrameSize(framesize_t frameSize)
{
    sensor_t *s = sensor();
    if (!s) return false;
    _frameSize = frameSize;
    return s->set_framesize(s, frameSize) == 0;
}

bool CameraConfig::setJpegQuality(int q)
{
    sensor_t *s = sensor();
    if (!s) return false;
    _jpegQuality = q;
    return s->set_quality(s, q) == 0;
}

bool CameraConfig::configureForWebApp()
{
    return setFrameSize(FRAMESIZE_VGA) && setJpegQuality(10);
}

bool CameraConfig::saveImage(fs::FS &fs, const char *path)
{
    camera_fb_t *fb = captureFrame();
    if (!fb) return false;

    File f = fs.open(path, FILE_WRITE);
    if (!f) {
        setError(String("Cannot open file: ") + path);
        releaseFrame(fb);
        return false;
    }
    f.write(fb->buf, fb->len);
    f.close();
    releaseFrame(fb);
    return true;
}

String CameraConfig::nextImagePath(const char *prefix, const char *ext)
{
    static uint32_t idx = 0;
    return String(prefix) + String(idx++) + ext;
}