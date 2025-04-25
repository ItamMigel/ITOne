import axios from 'axios'

// Base API configuration
const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add auth token to requests if it exists
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Authentication interfaces
export interface LoginCredentials {
  username: string
  password: string
}

export interface RegisterData {
  username: string
  email: string
  password: string
  full_name?: string
}

export interface User {
  id: number
  username: string
  email: string
  full_name?: string
  disabled: boolean
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
}

// Authentication API functions
export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    // Create URLSearchParams for x-www-form-urlencoded data
    const formData = new URLSearchParams()
    formData.append('username', credentials.username)
    formData.append('password', credentials.password)
    
    const response = await axios.post(`${api.defaults.baseURL}/auth/token`, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    return response.data
  },
  
  register: async (data: RegisterData): Promise<User> => {
    const response = await api.post('/auth/register', data)
    return response.data
  },
  
  getCurrentUser: async (): Promise<User> => {
    const response = await api.get('/auth/users/me')
    return response.data
  }
}

// Chat API interfaces
export interface ChatHistoryEntry {
  id: number
  user_id: number
  chat_id: number
  message: string
  response: string
  recommendations?: string
  piperflow_text?: string
  created_at: string
  updated_at: string
}

export interface ChatEntry {
  user_id: number
  chat_id: number
  message: string
  response: string
  recommendations?: string
  piperflow_text?: string
}

export interface Chat {
  id: number
  user_id: number
  name: string
  created_at: string
  updated_at: string
}

// Chat API functions
export const chatApi = {
  // Get all chats for a user
  getChats: async (): Promise<Chat[]> => {
    const response = await api.get('/chat/chats')
    return response.data
  },
  
  // Create a new chat - можно передать либо отдельные параметры, либо объект
  createChat: async (userIdOrData: number | { user_id: number, name?: string }, name: string = 'Новый чат'): Promise<Chat> => {
    let data: { user_id: number, name: string };
    
    if (typeof userIdOrData === 'number') {
      data = { user_id: userIdOrData, name }
    } else {
      data = { 
        user_id: userIdOrData.user_id, 
        name: userIdOrData.name || 'Новый чат' 
      }
    }
    
    const response = await api.post('/chat/chats', data)
    return response.data
  },
  
  // Update a chat
  updateChat: async (chatId: number, data: Partial<Chat>): Promise<Chat> => {
    const response = await api.put(`/chat/chats/${chatId}`, data)
    return response.data
  },
  
  // Delete a chat
  deleteChat: async (chatId: number): Promise<boolean> => {
    try {
      await api.delete(`/chat/chats/${chatId}`)
      return true
    } catch (error) {
      console.error(`Error deleting chat ${chatId}:`, error)
      return false
    }
  },
  
  // Get chat history
  getChatHistory: async (chatId: number): Promise<ChatHistoryEntry[]> => {
    const response = await api.get(`/chat/chat?chat_id=${chatId}`)
    return response.data
  },
  
  // Get a specific chat entry by ID
  getChatEntry: async (entryId: number): Promise<ChatHistoryEntry> => {
    const response = await api.get(`/chat/chat/${entryId}`)
    return response.data
  },
  
  // Save a chat entry
  saveChatEntry: async (entry: ChatEntry): Promise<ChatHistoryEntry> => {
    const response = await api.post('/chat/chat', entry)
    return response.data
  },
  
  // Update an existing chat entry
  updateChatEntry: async (entryId: number, data: Partial<ChatEntry>): Promise<ChatHistoryEntry> => {
    const response = await api.put(`/chat/chat/${entryId}`, data)
    return response.data
  },
  
  // Generate BPMN diagram from text description
  generateBpmnDiagram: async (description: string, requestId?: string): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    recommendations?: string;
    is_bpmn_request?: boolean;
  }> => {
    try {
      const response = await api.post('/api/bpmn/process_bpmn', { 
        user_prompt: description,
        business_requirements: "1. Схема должна быть грамотная и удобная для чтения. 2. Если возможно какой-то комплексный блок разбить на меньшие блоки - сделай это"
      });
      
      return {
        success: response.data.status === "success",
        text: response.data.piperflow_text,
        recommendations: response.data.recommendations,
        is_bpmn_request: true
      };
    } catch (error: any) {
      console.error("Error generating BPMN diagram:", error);
      return {
        success: false, 
        error: error.response?.data?.detail || "Ошибка при создании диаграммы"
      };
    }
  },
  
  generateRecommendations: async (piperflow: string, currentProcess: string, businessRequirements?: string): Promise<string> => {
    const response = await api.post('/api/bpmn/recommendations', {
      piperflow_text: piperflow,
      current_process: currentProcess,
      business_requirements: businessRequirements || "1. Схема должна быть грамотная и удобная для чтения. 2. Если возможно какой-то комплексный блок разбить на меньшие блоки - сделай это"
    })
    return response.data.recommendations
  },
  
  applyRecommendations: async (piperflow: string, recommendations: string, businessRequirements?: string): Promise<{
    success: boolean;
    updated_piperflow?: string;
    xml?: string;
    error?: string;
  }> => {
    try {
      console.log("Calling apply_recommendations API endpoint...");
      
      const response = await api.post('/api/bpmn/apply_recommendations', {
        piperflow_text: piperflow,
        recommendations: recommendations,
        business_requirements: businessRequirements || "1. Схема должна быть грамотная и удобная для чтения. 2. Если возможно какой-то комплексный блок разбить на меньшие блоки - сделай это"
      });
      
      console.log("apply_recommendations API response received:", {
        statusCode: response.status,
        dataLength: response.data ? JSON.stringify(response.data).length : 0
      });
      
      if (!response.data || !response.data.piperflow_text) {
        console.warn("API response missing expected data:", response.data);
        return {
          success: false,
          error: "Получен неполный ответ от сервера"
        };
      }
      
      return {
        success: true,
        updated_piperflow: response.data.piperflow_text,
        xml: response.data.xml
      };
    } catch (error: any) {
      console.error("Error applying recommendations:", error);
      let errorMessage = "Ошибка при применении рекомендаций";
      
      if (error.response) {
        console.error("Error response:", {
          status: error.response.status,
          data: error.response.data
        });
        errorMessage = error.response.data?.detail || errorMessage;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

export default api 