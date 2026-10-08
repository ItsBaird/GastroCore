# GastroCore

## Cómo levantar el proyecto

### Requisitos
- Docker y Docker Compose v2
- `bash` y `curl` (para el smoke test)

### Pasos
```bash
cp .env.example .env      # ajusta los valores si hace falta
docker compose up -d --build
docker compose ps         # todos deben quedar "healthy"
```
La aplicación queda en `http://localhost` (solo el gateway publica puerto).

### Smoke test
```bash
bash scripts/smoke-gateway.sh
```
Imprime OK/FAIL por verificación. Detiene y reinicia `catalog` durante la prueba y el límite de login es por minuto: espera ~60 s entre ejecuciones. Más detalle en [docs/gateway.md](docs/gateway.md).
