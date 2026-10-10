from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routes import router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Control Lab API",
        version="1.0.0",
        description="Проверка, сборка и моделирование структурных схем САУ.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(router)
    return app


app = create_app()
