

## To check docker is running
```
docker compose up -d            # start all services in background
docker compose ps               # see what's running
docker compose logs db          # view logs for the db service
docker compose logs -f db       # follow logs live
docker compose down             # stop & remove containers (volumes stay)
docker compose down -v          # stop & ALSO delete volumes (wipes data!)
docker compose restart db       # restart one service
docker compose exec db psql -U postgres -d my_database   # open db shell
docker compose exec cache redis-cli                      # open redis shell
```

Prisma 7 setup — step by step
1. Install the right packages

bash

npm install prisma@7 @prisma/client@7 @prisma/adapter-pg
Prisma 7 needs a driver adapter (@prisma/adapter-pg for Postgres). Make sure no Prisma 8 packages (@prisma/orm-postgres) are mixed in.

2. Write prisma.config.ts (project root)

typescript

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),   // in Prisma 7 the URL lives here, NOT in schema.prisma
  },
});
3. Write 
schema.prisma
 — generator client, datasource db { provider = "postgresql" } (no url line), then your models.

4. Set DATABASE_URL in .env


DATABASE_URL=postgresql://postgres:mysecretpassword@127.0.0.1:5433/my_database
5. Start Postgres and apply the schema

bash

docker compose up -d db
npx prisma migrate dev --name init
6. Generate the client

bash

npx prisma generate
7. Use the client with the adapter (
prisma.ts
)

typescript

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
export const prisma = new PrismaClient({ adapter });


## Prisma commands

npx prisma migrate dev --name <change>   # create + apply a migration after editing schema
npx prisma generate                       # regenerate the typed client manually
npx prisma validate                       # check your schema for errors (no DB needed)
npx prisma format                         # auto-format/indent schema.prisma


## connect to docker db

docker compose exec db psql -U postgres -d my_database