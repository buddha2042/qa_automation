const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
const API_BASE_URL = `${BASE_URL}/api`;

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message || `API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export const SisenseDashboardApi = {
  getAll: async (page = 1, pageSize = 10) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards?page=${page}&per_page=${pageSize}`);
    return handleResponse<{
      success: boolean;
      data: unknown[];
      pagination: { total_pages: number };
    }>(response);
  },

  getById: async (id: string | number) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards/${id}`);
    return handleResponse<{ success: boolean; data: unknown }>(response);
  },

  create: async (sisenseDashboardData: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: unknown }>(response);
  },

  update: async (id: string | number, sisenseDashboardData: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/SisenseDashboards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: unknown }>(response);
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
    return handleResponse<{ success: boolean; data: unknown }>(response);
  },

  saveSisenseDashboard: async (sisenseDashboardData: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE_URL}/save-SisenseDashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sisenseDashboardData),
    });
    return handleResponse<{ success: boolean; data: unknown }>(response);
  },
};

const api = {
  SisenseDashboards: SisenseDashboardApi,
  documents: documentApi,
};

export default api;
