import uuid
from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from app.db.base import Base

workflow_status_enum = Enum(
    "pending_ingest",
    "processing",
    "under_review",
    "complete",
    "flagged",
    name="workflow_status",
)

case_event_type_enum = Enum(
    "admission",
    "diagnosis",
    "procedure",
    "medication",
    "lab",
    "note",
    "discharge",
    "death",
    "other",
    name="case_event_type",
)

lab_flag_enum = Enum(
    "low",
    "normal",
    "high",
    "critical",
    "unknown",
    name="lab_flag",
)

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    settings = Column(JSONB, nullable=False, default=dict)
    users = relationship("User", back_populates="tenant")
    cases = relationship("Case", back_populates="tenant")

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    email = Column(String, nullable=False, unique=True, index=True)
    username = Column(String, nullable=True, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    sso_subject = Column(String, nullable=True, unique=True, index=True)
    role = Column(String, nullable=False, default="reviewer")
    tenant = relationship("Tenant", back_populates="users")

class Case(Base):
    __tablename__ = "cases"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    title = Column(String, nullable=True)
    workflow_status = Column(
        workflow_status_enum,
        nullable=False,
        default="pending_ingest",
        server_default="pending_ingest",
    )
    tenant = relationship("Tenant", back_populates="cases")
    documents = relationship("Document", back_populates="case")
    extracted_events = relationship("ExtractedEvent", back_populates="case")
    patient_snapshots = relationship("PatientSnapshot", back_populates="case")
    lab_observations = relationship("LabObservation", back_populates="case")

class Document(Base):
    __tablename__ = "documents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    mime = Column(String, nullable=False)
    page_count = Column(Integer, nullable=True)
    sha256 = Column(String(64), nullable=False, unique=True, index=True)
    doc_type = Column(String, nullable=True)
    case = relationship("Case", back_populates="documents")
    pages = relationship("PageAsset", back_populates="document")
    patient_snapshots = relationship("PatientSnapshot", back_populates="source_document")
    lab_observations = relationship("LabObservation", back_populates="source_document")

class PageAsset(Base):
    __tablename__ = "page_assets"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    page_number = Column(Integer, nullable=False)
    image_path = Column(String, nullable=False)
    ocr_confidence_page = Column(Float, nullable=True)
    word_confidences = Column(JSONB, nullable=True)
    low_confidence = Column(Integer, nullable=False, default=0, server_default="0")
    document = relationship("Document", back_populates="pages")

class ExtractedEvent(Base):
    __tablename__ = "extracted_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=True)
    sort_key = Column(String, nullable=True)
    type = Column(case_event_type_enum, nullable=False, default="other")
    summary = Column(Text, nullable=False)
    details = Column(JSONB, nullable=False, default=dict)
    source_refs = Column(JSONB, nullable=False, default=list)
    case = relationship("Case", back_populates="extracted_events")

class PatientSnapshot(Base):
    __tablename__ = "patient_snapshots"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    source_document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    mrn = Column(String, nullable=True)
    name = Column(String, nullable=True)
    dob = Column(DateTime(timezone=True), nullable=True)
    age_stated = Column(String, nullable=True)
    age_computed = Column(Integer, nullable=True)
    sex = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)
    case = relationship("Case", back_populates="patient_snapshots")
    source_document = relationship("Document", back_populates="patient_snapshots")

class LabObservation(Base):
    __tablename__ = "lab_observations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False)
    source_document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    name = Column(String, nullable=False)
    value = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    ref_low = Column(Float, nullable=True)
    ref_high = Column(Float, nullable=True)
    flag = Column(lab_flag_enum, nullable=False, default="unknown", server_default="unknown")
    source = Column(JSONB, nullable=False, default=dict)
    case = relationship("Case", back_populates="lab_observations")
    source_document = relationship("Document", back_populates="lab_observations")
