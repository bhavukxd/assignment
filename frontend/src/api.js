import axios from 'axios';

const API_URL = 'https://splitwise-app-1cdn.onrender.com';
const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Get import history for a group
export const getImportHistory = (groupId) => {
  return api.get(`/api/groups/${groupId}/imports`);
};

// Download import report
export const downloadImportReport = async (importId) => {
  try {
    const response = await api.get(`/api/imports/${importId}/report`, {
      responseType: 'blob' // Important for file download
    });
    
    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `import-report-${importId.slice(0, 8)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    
    return { success: true };
  } catch (err) {
    console.error('Error downloading report:', err);
    return { success: false, error: err.message };
  }
};

export default api;