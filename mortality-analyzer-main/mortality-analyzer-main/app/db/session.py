import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.db import models  # noqa: F401

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        print("Database is running:", result.scalar())
    print("Tables created successfully")
