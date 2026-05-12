from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import Analyst, User, UserRole
from app.schemas import AnalystCreate, AnalystOut, AnalystUpdate

router = APIRouter(prefix="/analysts", tags=["analysts"])


@router.get("", response_model=list[AnalystOut])
def list_analysts(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin, UserRole.accountant, UserRole.analyst)),
) -> list[Analyst]:
    return list(db.execute(select(Analyst).order_by(Analyst.full_name)).scalars())


@router.post("", response_model=AnalystOut, status_code=status.HTTP_201_CREATED)
def create_analyst(
    payload: AnalystCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> Analyst:
    analyst = Analyst(**payload.model_dump())
    db.add(analyst)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    db.refresh(analyst)
    return analyst


@router.patch("/{analyst_id}", response_model=AnalystOut)
def update_analyst(
    analyst_id: UUID,
    payload: AnalystUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> Analyst:
    analyst = db.get(Analyst, analyst_id)
    if analyst is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyst not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(analyst, field, value)
    db.commit()
    db.refresh(analyst)
    return analyst
