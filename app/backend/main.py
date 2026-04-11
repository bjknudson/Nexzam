from __future__ import annotations

from pathlib import Path
import zipfile

from fastapi import FastAPI, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .models import OpenBankRequest, QuestionModel, SaveBankRequest
from .service import BankWorkspaceError, BankWorkspaceService


app = FastAPI(title="Nexzam Backend", version="0.1.0")
service = BankWorkspaceService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(BankWorkspaceError)
def handle_workspace_error(_, exc: BankWorkspaceError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(ValidationError)
def handle_validation_error(_, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(RequestValidationError)
def handle_request_validation_error(_, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/health")
@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/banks/open")
def open_bank(request: OpenBankRequest):
    return service.open_bank(request.path)


@app.post("/api/banks/open-demo")
def open_demo_bank():
    repo_root = Path(__file__).resolve().parents[2]
    demo_dir = repo_root / "samples" / "demo-bank"
    demo_archive = repo_root / "samples" / "demo-bank.bok"
    if not demo_archive.exists():
        with zipfile.ZipFile(demo_archive, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in sorted(demo_dir.rglob("*")):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(demo_dir))
    return service.open_bank(str(demo_archive))


@app.get("/api/banks/current")
def get_current_bank():
    return service.get_summary()


@app.post("/api/banks/save")
def save_bank(request: SaveBankRequest):
    return {"saved_to": service.save_bank(request.destination_path)}


@app.get("/api/questions")
def list_questions(
    search: str | None = Query(default=None),
    topic: str | None = Query(default=None),
    question_type: str | None = Query(default=None, alias="type"),
):
    return service.list_questions(search=search, topic=topic, question_type=question_type)


@app.get("/api/questions/{question_id}")
def get_question(question_id: str):
    return service.get_question(question_id)


@app.put("/api/questions/{question_id}")
def update_question(question_id: str, payload: QuestionModel):
    return service.update_question(question_id, payload)
