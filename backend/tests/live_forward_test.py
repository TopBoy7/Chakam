import os, sys, threading, time, importlib.util, types
from pathlib import Path

BACKEND = Path("/Users/ndujekwuugochukwu/Documents/CODE/work/Chakam/backend")
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

# stub heavy-only deps not needed by main-light, but main-light imports none of them.
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from typing import List

# ---- fake HEAVY backend: echoes what it received, and can simulate errors ----
heavy = FastAPI()

@heavy.post("/courses/{courseCode}/register")
async def reg(courseCode: str,
              matricNumber: str = Form(...),
              fullName: str = Form(...),
              biometricConsent: str = Form(...),
              manualAltConsent: str = Form(...),
              ageConsent: str = Form(...),
              photos: List[UploadFile] = File(...)):
    if biometricConsent != "true":
        raise HTTPException(422, "biometric consent is required")
    total = 0
    for p in photos:
        total += len(await p.read())
    return {"success": True, "message": "registered",
            "data": {"student": {"matricNumber": matricNumber.upper(),
                                 "courseCode": courseCode,
                                 "fullName": fullName,
                                 "bytesReceived": total,
                                 "numPhotos": len(photos)}}}

def run_heavy():
    uvicorn.run(heavy, host="127.0.0.1", port=9099, log_level="warning")

t = threading.Thread(target=run_heavy, daemon=True)
t.start()
time.sleep(2.0)  # let it boot

# ---- load main-light pointed at the fake heavy backend ----
os.environ["HEAVY_BACKEND_URL"] = "http://127.0.0.1:9099"
spec = importlib.util.spec_from_file_location("main_light", BACKEND / "main-light.py")
ml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ml)

from fastapi.testclient import TestClient
client = TestClient(ml.app)

print("\n=== TEST 1: success path forwards multipart over real HTTP ===")
r = client.post("/courses/CSC301/register",
    data={"matricNumber":"mat777","fullName":"Live Test",
          "biometricConsent":"true","manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X"*1234, "image/jpeg")),
           ("photos",("b.jpg", b"Y"*4321, "image/jpeg"))])
print("status:", r.status_code)
print("body:", r.json())
d = r.json()["data"]["student"]
assert r.status_code == 201, r.status_code
assert d["matricNumber"] == "MAT777"
assert d["numPhotos"] == 2
assert d["bytesReceived"] == 1234+4321, d["bytesReceived"]
print("OK — both photos forwarded intact, byte counts match")

print("\n=== TEST 2: heavy 422 is relayed verbatim (not masked as 503) ===")
r = client.post("/courses/CSC301/register",
    data={"matricNumber":"mat1","fullName":"X",
          "biometricConsent":"false","manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X"*10, "image/jpeg"))])
print("status:", r.status_code, "detail:", r.json().get("detail"))
assert r.status_code == 422, r.status_code
assert r.json()["detail"] == "biometric consent is required"
print("OK — real heavy 422 relayed transparently")

print("\n=== TEST 3: heavy DOWN -> 503 service unavailable ===")
os.environ["HEAVY_BACKEND_URL"] = "http://127.0.0.1:9999"  # nothing listening
ml.HEAVY_BACKEND_URL = "http://127.0.0.1:9999"
r = client.post("/courses/CSC301/register",
    data={"matricNumber":"mat1","fullName":"X",
          "biometricConsent":"true","manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X"*10, "image/jpeg"))])
print("status:", r.status_code, "detail:", r.json().get("detail"))
assert r.status_code == 503, r.status_code
print("OK — transport failure correctly distinguished as 503")

print("\nALL LIVE FORWARDING TESTS PASSED")
