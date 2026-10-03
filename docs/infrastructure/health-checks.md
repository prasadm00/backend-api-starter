# Health Checks & Monitoring Probes

This document outlines the implementation of **Task 24 (Health Checks: Liveness & Readiness)**.

---

## 1. Overview & Kubernetes Principles

Modern cloud orchestrators (e.g. Kubernetes, AWS ECS, Google Cloud Run) require two distinct health probes to manage container lifecycles:

| Probe | Endpoint | Purpose | Failure Consequence |
| :--- | :--- | :--- | :--- |
| **Liveness** | `GET /health/live` | Verifies the Node.js process is alive, responding, and not in an unrecoverable deadlock. | **Restart**: Orchestrator kills and restarts the container pod. |
| **Readiness** | `GET /health/ready` | Verifies the service has established connections to all critical dependencies (DB, Redis) and can process incoming traffic. | **Don't Send Traffic**: Load balancer temporarily cuts traffic to this container until it recovers. |

---

## 2. Probe Lifecycle Architecture

```mermaid
flowchart TD
    subgraph Kube["Container Orchestrator (e.g. K8s Kubelet)"]
        LiveProbeTimer["Periodic Liveness Check\n(e.g. every 10s)"]
        ReadyProbeTimer["Periodic Readiness Check\n(e.g. every 5s)"]
    end

    subgraph Service["Application Instance"]
        LiveProbeTimer --> ReqLive["GET /health/live"]
        ReqLive --> LiveResp{"Process Alive?"}
        LiveResp -- "Yes" --> Live200["200 OK\nKeep Running"]
        LiveResp -- "No / Timeout" --> LiveFail["Container Restarted"]

        ReadyProbeTimer --> ReqReady["GET /health/ready"]
        ReqReady --> DBCheck{"Prisma Query (SELECT 1)"}
        DBCheck -- "Fail" --> Ready503["503 Service Unavailable\nstatus: 'not_ready'"]
        DBCheck -- "Pass" --> RedisCheck{"Redis Ping (PING -> PONG)"}
        RedisCheck -- "Fail" --> Ready503
        RedisCheck -- "Pass" --> Ready200["200 OK\nstatus: 'ready'"]

        Ready200 --> TrafficIn["Load Balancer Routes Traffic In"]
        Ready503 --> TrafficOut["Load Balancer Drops Instance from Pool\n('Don't Send Traffic')"]
    end
```

---

## 3. Endpoints & Response Payloads

### Liveness Probe (`GET /health/live`)
Fast, non-blocking check that does not touch external resources.

* **Response Status**: `200 OK`
* **Response Body**:
  ```json
  {
    "status": "ok",
    "uptimeSeconds": 142,
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```

---

### Readiness Probe (`GET /health/ready`)
Inspects PostgreSQL and Redis connectivity concurrently.

* **All Dependencies Healthy (`200 OK`)**:
  ```json
  {
    "status": "ready",
    "checks": {
      "database": {
        "status": "up",
        "latencyMs": 2
      },
      "redis": {
        "status": "up",
        "latencyMs": 1
      }
    },
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```

* **Degraded Dependency (`503 Service Unavailable`)**:
  ```json
  {
    "status": "not_ready",
    "checks": {
      "database": {
        "status": "down",
        "latencyMs": 5,
        "error": "Database connection refused"
      },
      "redis": {
        "status": "up",
        "latencyMs": 1
      }
    },
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```

---

## 4. Kubernetes Manifest Example

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 15
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```
