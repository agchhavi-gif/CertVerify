import React, { useState } from 'react';
import api from '../api/axios';
import styles from './VerifyPage.module.css';

const VerifyPage = () => {
  const [form, setForm] = useState({ name: '', certificateId: '' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setResult(null);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!form.name.trim() || !form.certificateId.trim()) {
      setError('Please fill in both fields.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/verify', {
        name: form.name.trim(),
        certificateId: form.certificateId.trim(),
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>🎓 CertVerify</span>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Certificate Verification</h1>
          <p className={styles.subtitle}>
            Enter your name and Certificate ID exactly as printed on your certificate.
          </p>
        </div>

        <div className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <div className={styles.field}>
              <label htmlFor="name" className={styles.label}>
                Participant Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder="Full name as on your certificate"
                value={form.name}
                onChange={handleChange}
                className={styles.input}
                autoComplete="name"
                aria-required="true"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="certificateId" className={styles.label}>
                Certificate ID
              </label>
              <input
                id="certificateId"
                name="certificateId"
                type="text"
                placeholder="Certificate ID as on your certificate"
                value={form.certificateId}
                onChange={handleChange}
                className={styles.input}
                autoComplete="off"
                aria-required="true"
              />
            </div>

            {error && (
              <div className={styles.errorBox} role="alert">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <span className={styles.spinner} aria-label="Verifying..." />
              ) : (
                'Verify Certificate'
              )}
            </button>
          </form>

          {/* Result */}
          {result && (
            <div
              className={`${styles.result} ${result.valid ? styles.valid : styles.invalid}`}
              role="status"
              aria-live="polite"
            >
              <span className={styles.resultIcon}>
                {result.valid ? '✅' : '❌'}
              </span>
              <p className={styles.resultMessage}>{result.message}</p>

              {result.valid && result.certificate && (
                <dl className={styles.certDetails}>
                  <div className={styles.detailRow}>
                    <dt>Certificate ID</dt>
                    <dd>{result.certificate.certificateId}</dd>
                  </div>
                  <div className={styles.detailRow}>
                    <dt>Name</dt>
                    <dd>{result.certificate.recipientName}</dd>
                  </div>
                  <div className={styles.detailRow}>
                    <dt>Issue Date</dt>
                    <dd>{formatDate(result.certificate.issueDate)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        © {new Date().getFullYear()} CertVerify
      </footer>
    </div>
  );
};

export default VerifyPage;
