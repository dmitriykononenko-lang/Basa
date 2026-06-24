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

    data = payload.model_dump(exclude_unset=True)

    # Валидация user_id: должен указывать на существующего пользователя
    # и не быть уже привязан к другому аналитику.
    if "user_id" in data and data["user_id"] is not None:
        new_user_id = data["user_id"]
        if db.get(User, new_user_id) is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"User {new_user_id} not found")
        other = db.execute(
            select(Analyst).where(Analyst.user_id == new_user_id, Analyst.id != analyst.id)
        ).scalar_one_or_none()
        if other is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User уже привязан к аналитику {other.full_name}",
            )

    for field, value in data.items():
        setattr(analyst, field, value)
    db.commit()
    db.refresh(analyst)
    return analyst
