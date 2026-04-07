// seed.js
require("dotenv").config();
const connectDB = require("./config/db");
const User = require("./models/user");
const Classroom = require("./models/classroom");
const bcrypt = require("bcryptjs");

const SEED_PASSWORD = "pass123";

async function seed() {
  await connectDB();
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  // admin
  await User.updateOne(
    { username: "admin" },
    { $set: { password: hashedPassword, fullName: "Administrator", role: "admin" } },
    { upsert: true }
  );
  console.log("admin upserted");

  // sample classroom
  if (!await Classroom.findOne({ name: "B-101" })) {
    const cls = new Classroom({
      name: "B-101",
      rows: 5,
      benchesPerRow: 2,
      seatsPerBench: 2,
      capacity: 20,
      pattern: "gap",
      gap: 2,
      classesAllowed: ["CSE-A","CSE-B","CSE-C"]
    });
    await cls.save();
    console.log("classroom created");
  }

  // create teachers
  await User.updateOne(
    { username: "teacher1" },
    { $set: { password: hashedPassword, fullName: "T One", role: "teacher" } },
    { upsert: true }
  );
  console.log("teacher1 upserted");

  // create some students across classes
  const studentOps = [];
  let idx = 1;
  for (let clsName of ["CSE-A","CSE-B","CSE-C"]) {
    for (let r = 1; r <= (clsName==="CSE-A"?8:(clsName==="CSE-B"?7:5)); r++) {
      const username = `s${idx}`;
      studentOps.push({
        updateOne: {
          filter: { username },
          update: {
            $set: {
              password: hashedPassword,
              fullName: `${clsName}-Student-${r}`,
              role: "student",
              rollNumber: r,
              className: clsName
            }
          },
          upsert: true
        }
      });
      idx++;
    }
  }
  await User.bulkWrite(studentOps);
  console.log("students upserted");

  console.log(`Seed done (default password: ${SEED_PASSWORD})`);
  process.exit(0);
}

seed();
