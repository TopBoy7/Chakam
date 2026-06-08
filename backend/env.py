import os
from dotenv import load_dotenv


# DATABASE_URL is required by BOTH backends (they share the same MongoDB).
REQUIRED_ENV_VARS = [
    "DATABASE_URL",
]

# Cloudinary is only used by the HEAVY backend (main.py) for image uploads.
# The light backend (main-light.py) on Render never touches Cloudinary, so we
# treat these as optional — they are validated lazily where they are used.
OPTIONAL_ENV_VARS = [
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "CLOUDINARY_CLOUD_NAME",
]

load_dotenv()


def validate_env():
    missing_vars = []
    env_vars = {}

    for var in REQUIRED_ENV_VARS:
        value = os.getenv(var)
        if value is None:
            missing_vars.append(var)
        else:
            env_vars[var] = value

    if missing_vars:
        print(f"Missing required environment variables: {', '.join(missing_vars)}")
        exit(1)

    for var in OPTIONAL_ENV_VARS:
        env_vars[var] = os.getenv(var)

    missing_optional = [v for v in OPTIONAL_ENV_VARS if not env_vars.get(v)]
    if missing_optional:
        print(
            "Note: Cloudinary vars not set "
            f"({', '.join(missing_optional)}). This is fine for the light "
            "backend; the heavy backend (image uploads) requires them."
        )

    return env_vars


env_vars = validate_env()

MONGO_URI = env_vars["DATABASE_URL"]
CLOUDINARY_API_KEY = env_vars.get("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = env_vars.get("CLOUDINARY_API_SECRET")
CLOUDINARY_CLOUD_NAME = env_vars.get("CLOUDINARY_CLOUD_NAME")




