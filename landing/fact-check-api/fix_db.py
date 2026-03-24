import os
import sys

# Add current directory to path so we can import models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.database import engine
from sqlalchemy import text

def run_migrations():
    if not engine:
        print("Engine not initialized. Check DATABASE_URL")
        return
        
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE fact_check_reports ADD COLUMN upvotes INTEGER DEFAULT 0 NOT NULL;"))
            print("✅ Successfully added 'upvotes' column.")
        except Exception as e:
            print(f"ℹ️ 'upvotes' column might already exist or error: {e}")
            
        try:
            conn.execute(text("ALTER TABLE fact_check_reports ADD COLUMN downvotes INTEGER DEFAULT 0 NOT NULL;"))
            print("✅ Successfully added 'downvotes' column.")
        except Exception as e:
            print(f"ℹ️ 'downvotes' column might already exist or error: {e}")

if __name__ == "__main__":
    run_migrations()
