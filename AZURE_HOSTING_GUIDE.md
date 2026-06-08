# Hosting the Heavy Backend on Azure (GitHub Student Developer Pack)

This guide walks you through hosting `backend/main.py` (the heavy backend: YOLO person
counting + `face_recognition` + Cloudinary) on Azure, using the **free Azure for Students**
benefit that comes with your GitHub Student Developer Pack — **no credit card required**.

It is written for **your exact workflow**: you keep the heavy server **switched off most of
the time** to preserve credit, and only turn it on when you need image processing / face
registration. The rest of the app (CRUD + dashboard) stays live on Render the whole time.

---

## 0. TL;DR — what you'll build

- A small **Ubuntu Linux Virtual Machine** running the heavy FastAPI app.
- A **permanent DNS name** (e.g. `chakam-heavy.westeurope.cloudapp.azure.com`) so the address
  **never changes**, even after you stop and restart the VM.
- You **`Stop (deallocate)`** the VM when idle → you stop paying for compute (you only pay a
  few cents/day for the disk). You **`Start`** it when you need it → same DNS name, ready in ~1 min.
- On Render you set `HEAVY_BACKEND_URL` to that DNS name once, and never touch it again.

> **Why a VM and not App Service / Functions?** The heavy app pulls in `dlib`, `torch`
> (via ultralytics), and `opencv` — large native libraries that are awkward and slow on
> App Service/Functions and easy to run on a VM. A VM also lets you **deallocate to $0
> compute** on demand, which is exactly what you want. (A scale-to-zero alternative is in
> Appendix B.)

---

## 1. Activate "Azure for Students" (free $100, no card)

1. Go to **https://azure.microsoft.com/free/students** (or open the **Azure** offer inside your
   GitHub Student Developer Pack at https://education.github.com/pack).
2. Sign in / create a Microsoft account and **verify with your school email**.
3. You get **$100 of credit valid for 12 months** + a set of always-free services.
   It is **renewable** each year while you remain a verified student.
4. **Spending limit is ON by default.** When the $100 runs out, Azure **disables** paid
   resources instead of charging you — so there is **no risk of a surprise bill**. Good.

> Tip: Install the Azure CLI locally (`az`) — it makes start/stop one command.
> macOS: `brew install azure-cli` then `az login`.

---

## 2. Create the VM (Portal — the easy path)

1. In the [Azure Portal](https://portal.azure.com): **Create a resource → Virtual machine**.
2. **Basics:**
   - **Resource group:** create `chakam-rg`.
   - **VM name:** `chakam-heavy`.
   - **Region:** pick the one **closest to you** for low latency (e.g. *South Africa North*,
     *West Europe*, or keep *Switzerland North* if that's what you used before).
   - **Image:** **Ubuntu Server 22.04 LTS** (x64 Gen2).
   - **Size:** click *See all sizes* and choose a **B-series burstable** VM:
     - **Standard_B2s** — 2 vCPU / **4 GiB** RAM → cheapest size that works (add swap, step 5).
     - **Standard_B2ms** — 2 vCPU / **8 GiB** RAM → comfortable; recommended if your credit allows.
     - ❌ Avoid B1s (1 GiB) — too small to even build `dlib`.
   - **Authentication:** **SSH public key** (generate a new key pair, download the `.pem`).
   - **Username:** `azureuser`.
3. **Networking tab → Inbound port rules:** allow **SSH (22)** and **HTTP (80)**.
   (We'll serve the API on port 80. If you'd rather use 8000, allow 8000 instead.)
4. **Review + create → Create.** Download the private key when prompted.

### Give it a permanent DNS name (do this once — critical!)
A VM with a *dynamic* public IP gets a **new IP every time you restart it**, which would break
`HEAVY_BACKEND_URL`. Fix it with a free DNS label:

1. Go to your VM → **Overview** → click the **Public IP address** resource.
2. **Configuration** → set **DNS name label** to e.g. `chakam-heavy`.
3. Save. Your permanent address is now
   **`chakam-heavy.<region>.cloudapp.azure.com`** (e.g. `chakam-heavy.westeurope.cloudapp.azure.com`).
   This name **survives deallocation** — that's what Render will point at.

> (Alternative: set the public IP to **Static** — also works but costs a little while the VM
> is stopped. The DNS-label approach above is free.)

<details>
<summary><b>Same thing with the Azure CLI (copy-paste)</b></summary>

```bash
az group create -n chakam-rg -l westeurope

az vm create \
  -g chakam-rg -n chakam-heavy \
  --image Ubuntu2204 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-address-dns-name chakam-heavy      # ← permanent DNS label

# open the HTTP port
az vm open-port -g chakam-rg -n chakam-heavy --port 80 --priority 900

# show the permanent address
az vm show -d -g chakam-rg -n chakam-heavy --query fqdns -o tsv
```
</details>

---

## 3. Install the app on the VM

SSH in (use the key you downloaded):
```bash
ssh -i /path/to/chakam-heavy_key.pem azureuser@chakam-heavy.<region>.cloudapp.azure.com
```

Install the **system libraries** that `dlib` / `face_recognition` / `opencv` need:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  python3-venv python3-dev build-essential cmake \
  libopenblas-dev liblapack-dev \
  libgl1 libglib2.0-0 \
  git
```

### Add swap (so dlib build / YOLO inference don't run out of RAM on a 4 GiB box)
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm swap is active
```

### Get the code and install Python deps
```bash
git clone <your-repo-url> chakam
cd chakam/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt      # installs dlib/face_recognition — this is SLOW (5–15 min)
```

### Create the `.env`
```bash
cat > .env <<'EOF'
DATABASE_URL=mongodb+srv://<user>:<pass>@<cluster>/smartclassDB?retryWrites=true&w=majority
CLOUDINARY_CLOUD_NAME=<your_cloud_name>
CLOUDINARY_API_KEY=<your_key>
CLOUDINARY_API_SECRET=<your_secret>
EOF
```
> Use the **same `DATABASE_URL`** as Render — both backends share one MongoDB.
> `CLOUDINARY_*` are **required here** (the heavy backend uploads annotated images).

### First-run smoke test (on the VM)
```bash
sudo venv/bin/uvicorn main:app --host 0.0.0.0 --port 80
```
The first image request downloads `yolov8n.pt` automatically (the repo also ships it).
From your laptop:
```bash
curl http://chakam-heavy.<region>.cloudapp.azure.com/healthz
# {"status":"ok","service":"smart-classroom-api",...}
```
`Ctrl-C` to stop, then make it a proper service ↓.

---

## 4. Run it as a service (auto-restart, survives logout)

Create `/etc/systemd/system/chakam.service`:
```ini
[Unit]
Description=Chakam heavy backend (FastAPI + YOLO + face_recognition)
After=network.target

[Service]
User=azureuser
WorkingDirectory=/home/azureuser/chakam/backend
ExecStart=/home/azureuser/chakam/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 80
Restart=always
RestartSec=3
# allow binding to port 80 as a non-root user:
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```
Enable it:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chakam
sudo systemctl status chakam       # should be "active (running)"
journalctl -u chakam -f            # live logs
```
Now the app **starts automatically whenever the VM boots** — so after you `Start` the VM, it's
ready on its own.

---

## 5. Point Render at Azure

In your Render **light backend** service → **Environment**:
```
HEAVY_BACKEND_URL = http://chakam-heavy.<region>.cloudapp.azure.com
```
(Plain `http`, port 80. No trailing slash.) Save → Render redeploys. Done — the wiring is complete:

```
Frontend → Render (always on) → Azure VM (when you turn it on)
```

When the Azure VM is **off**, Render returns `success:false` for image/registration calls and
everything else keeps working. When it's **on**, those calls succeed transparently.

---

## 6. 💰 The money part — turn it off when idle

This is the whole point. **Deallocating** the VM stops all compute billing; you keep only the
small disk cost (a few cents/day). The DNS name and your setup are preserved.

**Stop (deallocate) when you're done:**
```bash
az vm deallocate -g chakam-rg -n chakam-heavy
```
or Portal → VM → **Stop**. (Make sure the status reads **"Stopped (deallocated)"**, not just
"Stopped" — only *deallocated* stops compute charges.)

**Start when you need it (DNS name unchanged, service auto-starts):**
```bash
az vm start -g chakam-rg -n chakam-heavy
# wait ~30–60s, then:
curl http://chakam-heavy.<region>.cloudapp.azure.com/healthz
```

### Optional: auto-shutdown so you never leave it on by accident
Portal → VM → **Auto-shutdown** → enable, pick a time (e.g. 23:00) and your timezone. Azure will
deallocate it daily so a forgotten VM can't drain your credit.

### Keep an eye on credit
- **Cost Management + Billing → Overview** shows remaining credit.
- Set a **Budget alert** (e.g. notify at $80 spent) under *Cost Management → Budgets*.
- Rough B-series cost while **running**: B2s ≈ **$0.04/hr** (~$1/day), B2ms ≈ **$0.08/hr**.
  Running it only for demos/registration sessions, $100 lasts the whole year easily.

---

## 7. ESP32-CAM ↔ this VM

The ESP32 firmware uses **plain HTTP**, which the Azure VM serves directly on port 80 — so the
camera **can** post straight to the VM:
```cpp
String serverName = "chakam-heavy.<region>.cloudapp.azure.com";
String serverPath = "/classrooms/<YOUR_CLASS_ID>/image";
const int serverPort = 80;
```
⚠️ But remember the trade-off (see `CHANGES_AND_TESTING.md` §3): if the camera posts **directly
to Azure**, the live dashboard updates only work while **Azure** is on, and the dashboard must
point at Azure too. To keep the dashboard live on **Render** even for camera updates, have the
ESP32 post to **Render over HTTPS** (Option A in that doc) — Render then forwards to this VM.

---

## 8. Common issues & fixes

| Symptom | Cause / fix |
|---|---|
| `pip install` killed during `dlib` | Out of RAM — make sure **swap is on** (step 3) or use a B2ms (8 GiB). |
| `ImportError: libGL.so.1` | Install `libgl1 libglib2.0-0` (step 3). |
| Render shows `503 ... currently unavailable` | The VM is **deallocated** or the service is down — `az vm start` and check `systemctl status chakam`. |
| Address works, then breaks after restart | You skipped the **DNS name label** — without it the IP changes. Set it (step 2) and update `HEAVY_BACKEND_URL`. |
| `curl /healthz` times out | NSG isn't allowing port 80 — re-run `az vm open-port ... --port 80`, or check the service is bound to `0.0.0.0:80`. |
| Cloudinary upload errors | `CLOUDINARY_*` not set in the VM's `.env`. |
| First image request is slow | One-time `yolov8n.pt` download + model warm-up. Subsequent requests are fast. |

---

## Appendix A — Docker on the VM (optional, cleaner deploys)

If you'd rather containerize, add this `Dockerfile` to `backend/`:
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y \
    build-essential cmake libopenblas-dev liblapack-dev libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 80
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]
```
Then on the VM: `docker build -t chakam-heavy . && docker run -d --restart unless-stopped --env-file .env -p 80:80 chakam-heavy`.

## Appendix B — Scale-to-zero alternative (Azure Container Apps)

If you don't want to manually start/stop a VM, **Azure Container Apps** can **scale to zero**:
you're billed only while a request is being handled, and it auto-sleeps when idle. Build the
image (Appendix A), push it to **Azure Container Registry**, then create a Container App with
**min replicas = 0**. Trade-off: a **cold start** of ~20–60s on the first request after idle
(loading torch + dlib + the YOLO model), and Container Apps need a bit more setup. For your
"occasionally on" usage with the Student plan, the **deallocate-the-VM** approach (main guide)
is simpler and just as cheap, so start there.
