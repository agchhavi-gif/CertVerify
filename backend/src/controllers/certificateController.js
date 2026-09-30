const pool = require('../db');
const extractCertData = require('../utils/extractCertData');
const fs = require('fs');

/**
 * POST /api/admin/upload
 * Upload certificate → extract fields → return for admin review.
 */
const uploadAndExtract = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const filePath = req.file.path;

  try {
    const extracted = await extractCertData(filePath);

    // Delete the file after extraction — we only store the 3 fields
    fs.unlinkSync(filePath);

    res.json({
      message: 'Extraction complete. Review the fields below before saving.',
      extracted: {
        certificateId: extracted.certificateId || '',
        recipientName: extracted.recipientName || '',
        issueDate: extracted.issueDate || '',
      },
      // Send raw text to frontend so admin can manually pick values if needed
      rawText: extracted.rawText,
    });
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Extraction error:', err);
    res.status(err.userFacing ? 422 : 500).json({
      message: err.userFacing ? err.message : 'Failed to process certificate.',
      error: err.message,
    });
  }
};

/**
 * POST /api/admin/save
 * Save the reviewed fields to DB.
 */
const saveCertificate = async (req, res) => {
  const { certificateId, recipientName, issueDate } = req.body;

  if (!certificateId || !recipientName || !issueDate) {
    return res.status(400).json({
      message: 'All three fields are required: Certificate ID, Participant Name, Issue Date.',
    });
  }

  const certId = certificateId.trim().toUpperCase();
  const name = recipientName.trim();
  const date = issueDate.trim();

  try {
    // Duplicate check
    const existing = await pool.query(
      'SELECT id FROM certificates WHERE certificate_id = $1',
      [certId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: `Certificate ID "${certId}" already exists in the database.`,
      });
    }

    const result = await pool.query(
      `INSERT INTO certificates (certificate_id, recipient_name, issue_date)
       VALUES ($1, $2, $3) RETURNING *`,
      [certId, name, date]
    );

    res.status(201).json({
      message: 'Certificate saved successfully.',
      certificate: result.rows[0],
    });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ message: 'Failed to save certificate.' });
  }
};

module.exports = { uploadAndExtract, saveCertificate };
