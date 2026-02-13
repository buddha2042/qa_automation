const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
const API_BASE_URL = `${BASE_URL}/api`;

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export const SisenseDashboardApi = {
  getAll: async (page: number = 1, pageSize: number = 10) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards?page=${page}&per_page=${pageSize}`);
    return handleResponse<{
      success: boolean;
      data: any[];
      pagination: { total_pages: number };
    }>(response);
  },

  getById: async (id: string | number) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards/${id}`);
    return handleResponse<{ success: boolean; data: any }>(response);
  },
  create: async (SisenseDashboardData: any) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: any }>(response);
  },

  update: async (id: string | number, SisenseDashboardData: any) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: any }>(response);
  },

  delete: async (id: string | number) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards/${id}`, {
      method: 'DELETE',
    });
    return handleResponse<{ success: boolean; message?: string }>(response);
  },
};

export const documentApi = {
  testSisenseDashboard: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/test-SisenseDashboard`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse<{ success: boolean; data: any }>(response);
  },

  saveSisenseDashboard: async (SisenseDashboardData: any) => {
    const response = await fetch(`${API_BASE_URL}/save-SisenseDashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: any }>(response);
  },
};

const api = {
  SisenseDashboards: SisenseDashboardApi,
  documents: documentApi,
};

export default api;