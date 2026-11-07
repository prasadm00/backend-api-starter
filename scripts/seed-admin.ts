/**
 * Creates or repairs the admin account.
 *
 * Reads ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars) from the environment; there are
 * no built-in defaults, so no default credentials can end up in a deployment.
 * Safe to re-run: it reuses the ADMIN role and an existing user with that email.
 * For an existing user it resets the password hash, sets status to ACTIVE and
 * adds the ADMIN role if missing. The password is never printed or logged.
 */
import argon2 from "argon2";
import { prisma } from "../src/config/prisma.js";

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error(
      "Explicit ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars) required",
    );
  }

  console.log(`\nSetting up admin user: ${email}...`);

  // 1. Ensure ADMIN role exists
  let adminRole = await prisma.role.findUnique({
    where: { name: "ADMIN" },
  });

  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: { name: "ADMIN" },
    });
    console.log("Created role: ADMIN");
  } else {
    console.log("Role ADMIN already exists");
  }

  // 2. Hash password
  const passwordHash = await argon2.hash(password);

  // 3. Find or create user
  const existingUser = await prisma.user.findUnique({
    where: { email },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });

  let user;
  if (existingUser) {
    // Update existing user with active status and password
    // (this also re-enables a DISABLED account, so re-running acts as a recovery path)
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash,
        status: "ACTIVE",
      },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });
    console.log(`Updated credentials for existing user: ${email}`);

    // Ensure ADMIN role is linked
    const hasAdminRole = user.roles.some((r) => r.role.name === "ADMIN");
    if (!hasAdminRole) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id,
        },
      });
      console.log(`Linked ADMIN role to user: ${email}`);
    }
  } else {
    // Create new admin user linked to ADMIN role
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        status: "ACTIVE",
        roles: {
          create: {
            roleId: adminRole.id,
          },
        },
      },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });
    console.log(`Successfully created new admin user: ${email}`);
  }

  console.log("\n=================================");
  console.log(" Admin Credentials for Testing: ");
  console.log("=================================");
  console.log(` Email:    ${email}`);
  // Deliberately not echoing the password: console output ends up in terminal
  // history and CI logs.
  console.log(" Password: [never printed]");
  console.log(` Role:     ADMIN`);
  console.log("=================================\n");
}

// Exit non-zero on failure so callers (shell, CI) can detect it; always disconnect
// Prisma so the process can exit.
seedAdmin()
  .catch((err) => {
    console.error("Error creating admin user:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
