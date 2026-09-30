import axios from 'axios';

const api = axios.create({
  // In production the backend serves the frontend, so the API is on the same origin
  baseURL: process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5000/api'),
  headers: { 'Content-Type': 'application/json' },
});

export default api;
