import React, { useState, useRef } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import styles from './AdminPage.module.css';

const AdminPage = () => {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState('upload'); // 'upload' | 'review' | 'done'
  const [fields, setFields] = useState({ certificateId: '', recipientName: '', issueDate: '' });
  const [rawText, setRawText] = useState('');
  const [saved, setSaved] = useState(null);
  const fileInputRef = useRef(null);

  // ── File handling ──
  const handleFile = (selected) => {
    if (!selected) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/webp'];
    if (!allowed.includes(selected.type)) { toast.error('Only PDF and image files are allowed.'); return; }
    if (selected.size > 10 * 1024 * 1024) { toast.error('File must be under 10 MB.'); return; }
    setFile(selected);
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };

  // ── Step 1: Upload & Extract ──
  const handleExtract = async (e) => {
    e.preventDefault();
    if (!file) { toast.error('Please select a certificate file first.'); return; }
    setExtracting(true);
    const formData = new FormData();
    formData.append('certificate', file);
    try {
      const res = await api.post('/admin/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFields({
        certificateId: res.data.extracted.certificateId || '',
        recipientName: res.data.extracted.recipientName || '',
        issueDate: res.data.extracted.issueDate || '',
      });
      setRawText(res.data.rawText || '');
      setStep('review');
      toast.success('Extraction complete. Please review the fields.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to extract data.');
    } finally {
      setExtracting(false);
    }
  };

  // ── Step 2: Save ──
  const handleSave = async (e) => {
    e.preventDefault();
    if (!fields.certificateId || !fields.recipientName || !fields.issueDate) {
      toast.error('All three fields are required before saving.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/admin/save', fields);
      setSaved(res.data.certificate);
      setStep('done');
      toast.success('Certificate saved!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setFields({ certificateId: '', recipientName: '', issueDate: '' });
    setRawText('');
    setSaved(null);
    setStep('upload');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>🎓 CertVerify</span>
        <span className={styles.badge}>Admin</span>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.title}>Upload Certificate</h1>
          <p className={styles.subtitle}>
            Upload a certificate to extract the participant name, certificate ID, and issue date.
            Review the extracted data before saving.
          </p>

          {/* Step indicator */}
          <div className={styles.steps}>
            {['Upload', 'Review', 'Saved'].map((label, idx) => {
              const stepKey = ['upload', 'review', 'done'][idx];
              const isActive = step === stepKey;
              const isDone = ['upload', 'review', 'done'].indexOf(step) > idx;
              return (
                <React.Fragment key={label}>
                  {idx > 0 && <div className={`${styles.stepLine} ${isDone ? styles.stepLineDone : ''}`} />}
                  <div className={`${styles.step} ${isActive ? styles.stepActive : isDone ? styles.stepDone : ''}`}>
                    <span className={styles.stepNum}>{isDone ? '✓' : idx + 1}</span>
                    <span>{label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* ── STEP 1: Upload ── */}
          {step === 'upload' && (
            <form onSubmit={handleExtract} noValidate>
              <div
                className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                aria-label="Upload certificate file"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.bmp,.tiff,.webp"
                  onChange={(e) => handleFile(e.target.files[0])}
                  className={styles.fileInput}
                  aria-hidden="true"
                />
                {file ? (
                  <div className={styles.fileSelected}>
                    <span className={styles.fileIcon}>📄</span>
                    <span className={styles.fileName}>{file.name}</span>
                    <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <span className={styles.uploadIcon}>📤</span>
                    <p className={styles.dropLabel}>Drag & drop or <span className={styles.browseLink}>browse</span></p>
                    <p className={styles.dropHint}>PDF, JPEG, PNG — max 10 MB</p>
                  </>
                )}
              </div>

              <button type="submit" className={styles.primaryBtn} disabled={!file || extracting} aria-busy={extracting}>
                {extracting ? <><span className={styles.spinner} /> Extracting data...</> : 'Extract Data from Certificate'}
              </button>
            </form>
          )}

          {/* ── STEP 2: Review ── */}
          {step === 'review' && (
            <form onSubmit={handleSave} noValidate>
              <div className={styles.reviewBanner}>
                🔍 Data extracted from <strong>{file?.name}</strong>. Review and correct if needed before saving.
              </div>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="certificateId" className={styles.label}>
                    Certificate ID <span className={styles.required}>*</span>
                    <span className={styles.hint}> — as printed on the certificate</span>
                  </label>
                  <input
                    id="certificateId"
                    type="text"
                    value={fields.certificateId}
                    onChange={(e) => setFields({ ...fields, certificateId: e.target.value })}
                    className={`${styles.input} ${!fields.certificateId ? styles.inputEmpty : ''}`}
                    placeholder="e.g. 6452219000000395001"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="recipientName" className={styles.label}>
                    Participant Name <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="recipientName"
                    type="text"
                    value={fields.recipientName}
                    onChange={(e) => setFields({ ...fields, recipientName: e.target.value })}
                    className={`${styles.input} ${!fields.recipientName ? styles.inputEmpty : ''}`}
                    placeholder="Full name as on certificate"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="issueDate" className={styles.label}>
                    Issue Date <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="issueDate"
                    type="date"
                    value={fields.issueDate}
                    onChange={(e) => setFields({ ...fields, issueDate: e.target.value })}
                    className={`${styles.input} ${!fields.issueDate ? styles.inputEmpty : ''}`}
                    required
                  />
                </div>
              </div>

              {/* Raw text panel — helps admin manually fill if extraction missed
              {rawText && (
                <details className={styles.rawPanel}>
                  <summary className={styles.rawSummary}>📄 View extracted raw text (use this to fill missing fields)</summary>
                  <pre className={styles.rawText}>{rawText}</pre>
                </details>
              )} */}

              <div className={styles.actions}>
                <button type="button" className={styles.secondaryBtn} onClick={handleReset} disabled={saving}>
                  ← Start Over
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={saving} aria-busy={saving}>
                  {saving ? <><span className={styles.spinner} /> Saving...</> : 'Confirm & Save'}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3: Done ── */}
          {step === 'done' && saved && (
            <div className={styles.successBox}>
              <div className={styles.successIcon}>✅</div>
              <h2 className={styles.successTitle}>Certificate Saved</h2>
              <dl className={styles.savedDetails}>
                <div className={styles.savedRow}>
                  <dt>Certificate ID</dt>
                  <dd>{saved.certificate_id}</dd>
                </div>
                <div className={styles.savedRow}>
                  <dt>Participant Name</dt>
                  <dd>{saved.recipient_name}</dd>
                </div>
                <div className={styles.savedRow}>
                  <dt>Issue Date</dt>
                  <dd>{formatDate(saved.issue_date)}</dd>
                </div>
              </dl>
              <button className={styles.primaryBtn} onClick={handleReset}>
                Upload Another Certificate
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminPage;
