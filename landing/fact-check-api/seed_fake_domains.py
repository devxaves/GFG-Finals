from models.database import SessionLocal, SuspiciousDomain

def seed():
    if not SessionLocal:
        print("❌ Database not configured.")
        return
        
    db = SessionLocal()
    domains = [
        {"domain": "theonion.com", "reason": "Satire/Fake News"},
        {"domain": "babylonbee.com", "reason": "Satire"},
        {"domain": "infowars.com", "reason": "Conspiracy/Fake News"}
    ]
    
    for d in domains:
        try:
            exists = db.query(SuspiciousDomain).filter(SuspiciousDomain.domain == d["domain"]).first()
            if not exists:
                db.add(SuspiciousDomain(domain=d["domain"], reason=d["reason"]))
                print(f"✅ Added {d['domain']} to SuspiciousDomain list.")
            else:
                print(f"ℹ️ {d['domain']} already exists in database.")
        except Exception as e:
            print(f"❌ Error adding {d['domain']}: {e}")
            
    db.commit()
    db.close()

if __name__ == "__main__":
    seed()
