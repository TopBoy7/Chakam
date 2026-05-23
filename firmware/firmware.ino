#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_http_server.h>
#include "CameraConfig.h"

// ================= WIFI =================
const char* ssid = "Electrify_labs";
const char* password = "12345678";

// ================= API =================
const char* serverUrl = "http://51.107.0.26/classrooms/COMP-LAB/image";
const char* deviceId = "dev-00134";

// ================= LOCAL AP STREAM =================
const char* apSsid = "ESP32-CAM-SETUP";
const char* apPassword = "12345678";

// ================= IO PINS =================
constexpr uint8_t LED_RED_PIN = 2;
constexpr uint8_t LED_GREEN_PIN = 41;
constexpr uint8_t LED_BLUE_PIN = 42;
constexpr uint8_t BUTTON_PIN = 1;

// ================= MODE CONTROL =================
constexpr uint32_t AP_MODE_DURATION_MS = 4UL * 60UL * 1000UL;  // 4 minutes

enum class OperatingMode : uint8_t {
    NormalUpload,
    ApStreaming
};

volatile bool gButtonInterrupt = false;
OperatingMode gMode = OperatingMode::NormalUpload;
uint32_t gApModeStartedAt = 0;
uint32_t gLastButtonHandledAt = 0;

httpd_handle_t gStreamServer = nullptr;

// ================= CAMERA =================
CameraConfig camera(
    CameraConfig::esp32S3WroomOV5640Pins(),
    PIXFORMAT_JPEG,
    FRAMESIZE_SVGA,
    12, 2,
    CameraConfig::SensorModel::OV2640
);

static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=frame";
static const char *STREAM_BOUNDARY = "\r\n--frame\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

void IRAM_ATTR onButtonFalling()
{
    gButtonInterrupt = true;
}

void setNormalCameraProfile()
{
    camera.setFrameSize(FRAMESIZE_SVGA);
    camera.setJpegQuality(12);
}

void setApStreamCameraProfile()
{
    camera.setFrameSize(FRAMESIZE_QVGA);
    camera.setJpegQuality(25);
}

esp_err_t streamHandler(httpd_req_t *req)
{
    camera_fb_t *fb = nullptr;
    esp_err_t res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
    if (res != ESP_OK) {
        return res;
    }

    while (true) {
        if (gMode != OperatingMode::ApStreaming) {
            return ESP_OK;
        }

        fb = camera.captureFrame();
        if (!fb) {
            return ESP_FAIL;
        }

        char partHeader[64];
        const size_t hlen = snprintf(partHeader, sizeof(partHeader), STREAM_PART, fb->len);

        res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, partHeader, hlen);
        }
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, reinterpret_cast<const char *>(fb->buf), fb->len);
        }

        camera.releaseFrame(fb);

        if (res != ESP_OK) {
            return res;
        }

        delay(50);
    }
}

esp_err_t indexHandler(httpd_req_t *req)
{
    static const char page[] =
        "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'/>"
        "<title>ESP32 Camera Stream</title></head><body style='font-family:sans-serif;background:#111;color:#eee;text-align:center;'>"
        "<h2>ESP32 Camera Low-Quality Stream</h2><img src='/stream' style='width:100%;max-width:720px;border-radius:8px'/>"
        "</body></html>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, page, HTTPD_RESP_USE_STRLEN);
}

bool startApStreamingServer()
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.max_uri_handlers = 8;

    if (httpd_start(&gStreamServer, &config) != ESP_OK) {
        gStreamServer = nullptr;
        return false;
    }

    httpd_uri_t indexUri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = indexHandler,
        .user_ctx = nullptr
    };

    httpd_uri_t streamUri = {
        .uri = "/stream",
        .method = HTTP_GET,
        .handler = streamHandler,
        .user_ctx = nullptr
    };

    httpd_register_uri_handler(gStreamServer, &indexUri);
    httpd_register_uri_handler(gStreamServer, &streamUri);
    return true;
}

void stopApStreamingServer()
{
    Serial.println("Stopping server");
    if (gStreamServer) {
        httpd_stop(gStreamServer);
        gStreamServer = nullptr;
    }
    Serial.println("Server stopped");
}

void enterApMode()
{
    Serial.println("[MODE] Switching to AP streaming mode");

    WiFi.disconnect(true, true);
    WiFi.mode(WIFI_AP);

    if (!WiFi.softAP(apSsid, apPassword)) {
        Serial.println("[AP] Failed to start SoftAP");
        WiFi.mode(WIFI_STA);
        connectWiFi();
        return;
    }

    setApStreamCameraProfile();
    if (!startApStreamingServer()) {
        Serial.println("[AP] Failed to start HTTP streaming server");
        WiFi.softAPdisconnect(true);
        WiFi.mode(WIFI_STA);
        setNormalCameraProfile();
        connectWiFi();
        return;
    }

    gMode = OperatingMode::ApStreaming;
    gApModeStartedAt = millis();

    digitalWrite(LED_BLUE_PIN, LOW);
    digitalWrite(LED_GREEN_PIN, LOW);

    Serial.print("[AP] Started. Connect to SSID: ");
    Serial.println(apSsid);
    Serial.print("[AP] Stream URL: http://");
    Serial.println(WiFi.softAPIP());
}

void exitApMode()
{
    Serial.println("[MODE] Leaving AP mode, restoring normal upload mode");

    stopApStreamingServer();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);
    delay(100);

    connectWiFi();
    setNormalCameraProfile();

    gMode = OperatingMode::NormalUpload;
}

// ================= WIFI CONNECT =================
void connectWiFi()
{
    Serial.print("[WIFI] Connecting");
    digitalWrite(LED_BLUE_PIN, LOW);

    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("\n[WIFI] Connected!");
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_BLUE_PIN, HIGH);
}

// ================= UPLOAD FRAME =================
bool uploadFrame(camera_fb_t *frame)
{
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] Not connected");
        digitalWrite(LED_GREEN_PIN, LOW);
        connectWiFi();
        return false;
    }

    HTTPClient http;
    http.setConnectTimeout(10000);
    http.setTimeout(15000); // 15s is plenty, server takes ~5s
    http.begin(serverUrl);

    http.addHeader("Accept", "application/json");

    String boundary = "esp32boundary123"; // No dashes here — added in body below

    String head =
        "--" + boundary + "\r\n"
        "Content-Disposition: form-data; name=\"deviceId\"\r\n\r\n" +
        String(deviceId) + "\r\n" +
        "--" + boundary + "\r\n"
        "Content-Disposition: form-data; name=\"file\"; filename=\"frame.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n";

    String tail = "\r\n--" + boundary + "--\r\n";

    size_t totalSize = head.length() + frame->len + tail.length();

    uint8_t *body = (uint8_t *)ps_malloc(totalSize); // Use PSRAM if available
    if (!body) {
        Serial.println("[ERROR] malloc failed");
        http.end();
        return false;
    }

    size_t pos = 0;
    memcpy(body + pos, head.c_str(), head.length()); pos += head.length();
    memcpy(body + pos, frame->buf, frame->len);      pos += frame->len;
    memcpy(body + pos, tail.c_str(), tail.length());

    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    http.addHeader("Content-Length", String(totalSize));

    int code = http.POST(body, totalSize);
    free(body);

    Serial.print("[HTTP] Response code: ");
    Serial.println(code);

    if (code == 200 || code == 201) {
        Serial.println("[SERVER] " + http.getString());
        digitalWrite(LED_GREEN_PIN, HIGH);
        http.end();
        return true;
    } else if (code > 0) {
        digitalWrite(LED_GREEN_PIN, LOW);
        Serial.println("[SERVER ERROR] " + http.getString());
    } else {
        Serial.print("[HTTP ERROR] ");
        Serial.println(http.errorToString(code));
        digitalWrite(LED_GREEN_PIN, LOW);
    }

    http.end();
    return false;
}

// ================= CAPTURE =================
camera_fb_t* captureFrame()
{
    camera_fb_t *frame = camera.captureFrame();
    if (!frame) {
        Serial.print("[ERROR] Capture failed: ");
        Serial.println(camera.lastError());
        return nullptr;
    }

    Serial.print("[CAM] Frame: ");
    Serial.print(frame->len);
    Serial.println(" bytes");

    return frame;
}

// ================= SETUP =================
void setup()
{
    Serial.begin(115200);
    delay(1000);

    pinMode(LED_RED_PIN, OUTPUT);
    pinMode(LED_GREEN_PIN, OUTPUT);
    pinMode(LED_BLUE_PIN, OUTPUT);
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), onButtonFalling, FALLING);

    digitalWrite(LED_RED_PIN, HIGH);
    digitalWrite(LED_GREEN_PIN, LOW);
    digitalWrite(LED_BLUE_PIN, LOW);

    Serial.println("=== ESP32-S3 CAMERA UPLOAD SYSTEM ===");

    if (!psramFound()) {
        Serial.println("[WARN] PSRAM missing");
    }

    connectWiFi();

    if (!camera.begin()) {
        Serial.print("[ERROR] Camera init failed: ");
        Serial.println(camera.lastError());
        while (true) delay(1000);
    }

    Serial.println("[OK] Camera ready");
    Serial.print("Sensor PID: 0x");
    Serial.println(camera.sensorPid(), HEX);
}

// ================= LOOP =================
void loop()
{
    if (gButtonInterrupt) {
        gButtonInterrupt = false;
        const uint32_t now = millis();
        if (now - gLastButtonHandledAt > 250) {
            gLastButtonHandledAt = now;
            if (gMode == OperatingMode::NormalUpload) {
                enterApMode();
            }
        }
    }

    if (gMode == OperatingMode::ApStreaming) {
        const uint32_t now = millis();
        if (now - gApModeStartedAt >= AP_MODE_DURATION_MS) {
            exitApMode();
        }
        delay(20);
        return;
    }

    camera_fb_t *frame = captureFrame();

    if (frame) {
        uploadFrame(frame);
        camera.releaseFrame(frame);
    }

    delay(3000);
}