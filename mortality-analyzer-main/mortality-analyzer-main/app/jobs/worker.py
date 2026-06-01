import time
import uuid

from app.db.models import Case, Document
from app.db.session import SessionLocal

def process_document(document_id: str):
    db = SessionLocal()
    try:
        document = db.query(Document).filter(Document.id == uuid.UUID(document_id)).first()
        if not document:
            print(f"Document {document_id} was not found")
            return
        case = db.query(Case).filter(Case.id == document.case_id).first()
        if not case:
            print(f"Case for document {document_id} was not found")
            return
        print(f"Processing document {document_id}")
        case.workflow_status = "processing"
        db.commit()
        time.sleep(2)
        print("Preprocessing done")
        time.sleep(2)
        print("OCR done")
        time.sleep(2)
        print("LLM extraction done")
        case.workflow_status = "complete"
        db.commit()
    finally:
        db.close()
