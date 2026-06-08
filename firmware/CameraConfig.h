#ifndef CAMERA_CONFIG_H
#define CAMERA_CONFIG_H

#include <FS.h>
#include <esp_camera.h>
#include <sensor.h>

class CameraConfig
{
public:
    enum class SensorModel : uint8_t { Any, OV2640, OV5640 };

    struct Pins {
        int pwdn = -1, reset = -1, xclk = -1;
        int sda = -1,  scl  = -1;
        int d7 = -1, d6 = -1, d5 = -1, d4 = -1;
        int d3 = -1, d2 = -1, d1 = -1, d0 = -1;
        int vsync = -1, href = -1, pclk = -1;
    };

    static Pins esp32S3WroomOV5640Pins();
    static Pins esp32S3EyePins();

    CameraConfig(const Pins &pins,
                 pixformat_t pixelFormat  = PIXFORMAT_JPEG,
                 framesize_t frameSize    = FRAMESIZE_SVGA,
                 int jpegQuality          = 12,
                 int fbCount              = 2,
                 SensorModel expectedSensor = SensorModel::OV5640);

    bool begin();
    void end();

    camera_fb_t *captureFrame();
    void         releaseFrame(camera_fb_t *frame);

    bool   saveImage(fs::FS &fs, const char *path);
    String nextImagePath(const char *prefix = "/img_", const char *ext = ".jpg");

    bool configureForWebApp();
    bool setFrameSize(framesize_t frameSize);
    bool setJpegQuality(int jpegQuality);

    sensor_t *sensor() const;
    uint16_t  sensorPid()  const { return _sensorPid; }
    bool      isOV5640()   const { return _sensorPid == OV5640_PID; }
    bool      isOV2640()   const { return _sensorPid == OV2640_PID; }
    bool      isReady()    const { return _initialised; }
    const String &lastError() const { return _lastError; }

private:
    Pins        _pins;
    pixformat_t _pixelFormat;
    framesize_t _frameSize;
    int         _jpegQuality;
    int         _fbCount;
    SensorModel _expectedSensor;

    bool     _initialised   = false;
    bool     _driverStarted = false;
    uint16_t _sensorPid     = 0;
    String   _lastError;

    camera_config_t buildConfig() const;
    void setError(const String &msg);
    bool validateSensorModel();
    void safeDeinit();
    static const char *sensorModelName(SensorModel model);
};

#endif // CAMERA_CONFIG_H