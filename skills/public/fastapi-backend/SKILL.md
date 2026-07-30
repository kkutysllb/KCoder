---
name: fastapi-backend
description: >-
  Use this skill for FastAPI backend work: routers, Pydantic models, request
  validation, dependency injection, middleware, service boundaries, and route
  tests.

package:
  type: knowledge-only
---

# FastAPI Backend Skill

## Purpose

Implement backend APIs with clear schemas, service isolation, and testable
error behavior.

## Workflow

1. Define Pydantic request/response models at the router boundary.
2. Delegate business logic to a service module.
3. Convert domain errors into appropriate HTTP status codes.
4. Register routers explicitly in the gateway app.
5. Add TestClient or service tests for success and failure paths.

## Review Checklist

- Route prefixes match frontend API clients.
- Optional fields and defaults are explicit.
- Service code does not depend on request objects.
- Router tests cover validation and domain errors.
