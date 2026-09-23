const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { uploadAndExtract, saveCertificate } = require('../controllers/certificateController');

// Step 1: upload file → extract fields for review
router.post('/upload', upload.single('certificate'), uploadAndExtract);

// Step 2: admin confirms → save to DB
router.post('/save', saveCertificate);

module.exports = router;
