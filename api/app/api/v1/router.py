from fastapi import APIRouter

from app.api.v1.endpoints import auth, users, projects, api_keys, agents, agent_definitions

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(users.router)
router.include_router(projects.router)
router.include_router(api_keys.router)
router.include_router(agents.router)
router.include_router(agent_definitions.router)
