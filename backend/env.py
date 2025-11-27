import os
from dotenv import load_dotenv


REQUIRED_ENV_VARS = [
    "DATABASE_URL"
    ]
load_dotenv()


def validate_env():

    missing_vars = []
    env_vars = {}

    for var in REQUIRED_ENV_VARS:
        value = os.getenv(var)

        if value is None:  # Check if the variable is missing
            missing_vars.append(var)
        else:
            env_vars[var] = value

    if missing_vars:
        print(f"Missing required environment variables: {', '.join(missing_vars)}")
        exit(1)

    return env_vars


env_vars = validate_env()

MONGO_URI = env_vars["DATABASE_URL"]



