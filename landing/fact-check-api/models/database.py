import os
import ssl
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None
Base = declarative_base()



class FactCheckReport(Base):
    """Stores every fact-check report (website + extension). 
    This is the main table for history, shared links, and deduplication."""
    __tablename__ = "fact_check_reports"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(String(128), index=True, nullable=True)  # Clerk user ID (null = anonymous)
    source = Column(String(20), nullable=False, default="website")  # "website" or "extension"
    input_type = Column(String(10), nullable=True)  # "url" or "text"
    input_content = Column(Text, nullable=True)  # The URL or first 500 chars of text
    url_hash = Column(String(64), index=True, nullable=True)  # MD5 hash of URL for dedup
    report_json = Column(Text, nullable=False)  # Full report JSON
    claims_json = Column(Text, nullable=True)  # Full claims JSON
    overall_score = Column(Integer, nullable=True)
    total_claims = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    upvotes = Column(Integer, nullable=False, default=0)
    downvotes = Column(Integer, nullable=False, default=0)


class VotingRecord(Base):
    """Tracks user votes on fact checks to prevent double-voting"""
    __tablename__ = "voting_records"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String(64), index=True, nullable=False)
    user_id = Column(String(128), index=True, nullable=False)
    vote_type = Column(String(10), nullable=False)  # "up" or "down"
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SuspiciousDomain(Base):
    """List of known fake news, heavily biased, or satirical domains"""
    __tablename__ = "suspicious_domains"

    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String(255), unique=True, index=True, nullable=False)
    reason = Column(String(255), nullable=True) # e.g. "Satire", "Fake News Network"


# Initialize all tables
if engine:
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ Database tables created/verified successfully.")
    except Exception as e:
        print(f"⚠️ Warning: Failed to create database tables: {e}")
