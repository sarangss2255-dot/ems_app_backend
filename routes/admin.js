const express = require("express");
const router = express.Router();
const multer = require("multer");
const adminController = require("../controllers/adminController");
const { authMiddleware, requireRole } = require("../middleware/auth");

// Configure multer to accept only CSV and XLSX files
const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".csv", ".xlsx", ".xls"];
  const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Only CSV and XLSX files are allowed"), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.post(
  "/classrooms",
  authMiddleware,
  requireRole("admin"),
  adminController.createClassroom
);

router.get(
  "/classrooms",
  authMiddleware,
  requireRole("admin"),
  adminController.listClassrooms
);

router.get(
  "/classrooms/:id",
  authMiddleware,
  requireRole("admin"),
  adminController.getClassroomById
);

router.put(
  "/classrooms/:id",
  authMiddleware,
  requireRole("admin"),
  adminController.updateClassroom
);

router.delete(
  "/classrooms/:id",
  authMiddleware,
  requireRole("admin"),
  adminController.deleteClassroom
);

router.get(
  "/classrooms/:id/generate",
  authMiddleware,
  requireRole("admin"),
  adminController.generateSeatingForClassroom
);

router.post(
  "/classrooms/:id/reshuffle",
  authMiddleware,
  requireRole("admin"),
  adminController.reshuffleSeatingForClassroom
);

router.post(
  "/classrooms/:id/move-seat",
  authMiddleware,
  requireRole("admin"),
  adminController.moveSeatForClassroom
);

router.get(
  "/classrooms/:id/export",
  authMiddleware,
  requireRole("admin"),
  adminController.exportSeatingCsv
);

router.post(
  "/students/bulk",
  authMiddleware,
  requireRole("admin"),
  adminController.bulkCreateStudents
);

router.get(
  "/students",
  authMiddleware,
  requireRole("admin"),
  adminController.listStudents
);

router.post(
  "/students/preview",
  authMiddleware,
  requireRole("admin"),
  upload.single("file"),
  adminController.previewStudentsUpload
);

router.post(
  "/students/upload",
  authMiddleware,
  requireRole("admin"),
  upload.single("file"),
  adminController.uploadStudents
);

router.delete(
  "/students/:identifier",
  authMiddleware,
  requireRole("admin"),
  adminController.deleteStudent
);

router.post(
  "/teachers/upload",
  authMiddleware,
  requireRole("admin"),
  upload.single("file"),
  adminController.uploadTeachers
);

router.get(
  "/students/export-credentials",
  authMiddleware,
  requireRole("admin"),
  adminController.exportStudentCredentials
);

router.post(
  "/classrooms/upload",
  authMiddleware,
  requireRole("admin"),
  upload.single("file"),
  adminController.uploadClassrooms
);

router.post(
  "/assign-teacher",
  authMiddleware,
  requireRole("admin"),
  adminController.assignTeacher
);

module.exports = router;
