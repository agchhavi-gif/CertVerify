const pool = require('../db');

/**
 * POST /api/verify
 * Public — verify a certificate by name + certificate ID.
 */
const verifyCertificate = async (req, res) => {
  const { name, certificateId } = req.body;

  if (!name || !certificateId) {
    return res.status(400).json({ message: 'Name and Certificate ID are required.' });
  }

  const certId = certificateId.trim().toUpperCase();
  const certName = name.trim();

  try {
    const result = await pool.query(
      `SELECT certificate_id, recipient_name, issue_date
       FROM certificates
       WHERE certificate_id = $1
         AND LOWER(TRIM(recipient_name)) = LOWER($2)`,
      [certId, certName]
    );

    if (result.rows.length === 0) {
      return res.json({
        valid: false,
        message: 'Certificate is invalid.',
      });
    }

    const cert = result.rows[0];
    return res.json({
      valid: true,
      message: 'Certificate is valid.',
      certificate: {
        certificateId: cert.certificate_id,
        recipientName: cert.recipient_name,
        issueDate: cert.issue_date,
      },
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Verification failed. Please try again.' });
  }
};

module.exports = { verifyCertificate };
