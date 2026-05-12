from fastapi import APIRouter

from app.api.v1.endpoints import amo, analysts, auth, payments, projects

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(analysts.router)
api_router.include_router(projects.router)
api_router.include_router(payments.router)
api_router.include_router(amo.router)
