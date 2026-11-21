from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Analyst, Project, ProjectStatus, User, UserRole
from app.schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _filter_for_analyst(stmt, user: User, db: Session):
    """Аналитик видит только свои проекты — джойн по analysts.user_id."""
    if user.role != UserRole.analyst:
        return stmt
    analyst = db.execute(select(Analyst).where(Analyst.user_id == user.id)).scalar_one_or_none()
    if analyst is None:
        return stmt.where(Project.id.is_(None))  # пустой результат
    return stmt.where(Project.analyst_id == analyst.id)


@router.get("", response_model=list[ProjectOut])
def list_projects(
    status_: Optional[ProjectStatus] = Query(default=None, alias="status"),
    analyst_id: Optional[UUID] = None,
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[Project]:
    stmt = select(Project).order_by(Project.started_at.desc().nullslast(), Project.created_at.desc())
    if status_ is not None:
        stmt = stmt.where(Project.status == status_)
    if analyst_id is not None:
        stmt = stmt.where(Project.analyst_id == analyst_id)
    if from_ is not None:
        stmt = stmt.where(Project.started_at >= from_)
    if to is not None:
        stmt = stmt.where(Project.started_at <= to)
    stmt = _filter_for_analyst(stmt, current, db)
    return list(db.execute(stmt).scalars())


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> Project:
    if db.get(Analyst, payload.analyst_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Analyst not found")
    project = Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    data = payload.model_dump(exclude_unset=True)
    if "analyst_id" in data and db.get(Analyst, data["analyst_id"]) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Analyst not found")
    for field, value in data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project
