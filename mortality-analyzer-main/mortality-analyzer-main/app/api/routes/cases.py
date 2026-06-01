import hashlib
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.db.models import Case, Document, Tenant
from app.jobs.worker import process_document
from app.storage.local import save_file

router = APIRouter()

def get_or_create_default_tenant(db: Session):
    tenant = db.query(Tenant).filter(Tenant.name == "Default Hospital").first()
    if tenant:
        return tenant

    tenant = Tenant(name="Default Hospital", settings={})
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant

def file_sha256(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as saved_file:
        for chunk in iter(lambda: saved_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

@router.post("/cases")
def create_case(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    tenant = get_or_create_default_tenant(db)

    new_case = Case(
        tenant_id=tenant.id,
        workflow_status="pending_ingest",
    )
    db.add(new_case)
    db.commit()
    db.refresh(new_case)

    file_path = save_file(file)

    document = Document(
        case_id=new_case.id,
        filename=file.filename,
        file_path=file_path,
        mime=file.content_type or "application/octet-stream",
        sha256=file_sha256(file_path),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    background_tasks.add_task(process_document, str(document.id))

    return {
        "case_id": str(new_case.id),
        "document_id": str(document.id),
        "file_path": file_path,
    }

@router.get("/cases/{case_id}")
def get_case(case_id: str, db: Session = Depends(get_db)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    return {
        "id": str(case.id),
        "status": case.workflow_status,
    }

@router.get("/cases/{case_id}/pages")
def get_pages(case_id: str):
    return {"message": "OCR output will come here"}
