import { useState, useRef, useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SendIcon, MicIcon, XIcon, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { ChatHistoryEntry, chatApi } from "@/lib/api"
import { useAuthStore } from "@/lib/auth"

// Add TypeScript declaration for webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext
  }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  image?: string
}

export function BpmnChat() {
  const location = useLocation()
  const { user } = useAuthStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [input, setInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [speechStatus, setSpeechStatus] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null)

  // Get chat ID from URL
  const params = new URLSearchParams(location.search)
  const chatId = params.get('chatId') ? parseInt(params.get('chatId')!) : null
  
  // Load chat history when chat ID changes
  useEffect(() => {
    if (chatId) {
      loadChatHistory(chatId)
    } else {
      // Clear messages if no chat is selected
      setMessages([
        {
          id: '1',
          role: 'assistant',
          content: 'Выберите существующий чат или создайте новый с помощью кнопки "+" в боковой панели.',
          timestamp: new Date()
        }
      ])
    }
  }, [chatId])
  
  // Load chat history
  const loadChatHistory = async (chatId: number) => {
    if (!chatId || !user?.id) return
    
    setIsLoadingHistory(true)
    try {
      const history = await chatApi.getChatHistory(chatId)
      
      // Convert history to messages format
      const formattedMessages = history.map(entry => [
        {
          id: `user-${entry.id}`,
          role: 'user' as const,
          content: entry.message,
          timestamp: new Date(entry.created_at)
        },
        {
          id: `assistant-${entry.id}`,
          role: 'assistant' as const,
          content: entry.response,
          timestamp: new Date(entry.created_at),
          image: entry.image
        }
      ]).flat()
      
      // Sort by timestamp (oldest first)
      formattedMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      
      setMessages(formattedMessages)
    } catch (error) {
      console.error("Failed to load chat history:", error)
      setMessages([
        {
          id: 'error',
          role: 'assistant',
          content: 'Не удалось загрузить историю чата.',
          timestamp: new Date()
        }
      ])
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (input.trim() === '' || !chatId || !user?.id) return
    
    // Add user message to UI immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date()
    }
    
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    
    try {
      // Расширенное определение запросов на генерацию BPMN диаграмм
      const userInput = input.toLowerCase();
      const isBpmnRequest = 
        // Явные запросы
        userInput.includes('диаграмм') || 
        userInput.includes('bpmn') ||
        userInput.includes('схема процесса') ||
        userInput.includes('схему процесса') ||
        userInput.includes('бизнес-процесс') ||
        userInput.includes('process diagram') ||
        userInput.includes('нарисуй') ||
        userInput.includes('построй') ||
        userInput.includes('показать процесс') ||
        userInput.includes('визуализируй') ||
        // Неявные запросы на процессы
        (userInput.includes('процесс') && 
          (
            userInput.includes('заказ') || 
            userInput.includes('покупк') || 
            userInput.includes('покупки') || 
            userInput.includes('оформлени') || 
            userInput.includes('регистрац') || 
            userInput.includes('авторизаци') || 
            userInput.includes('доставки') || 
            userInput.includes('оплаты') ||
            userInput.includes('учет') ||
            userInput.includes('продаж')
          )
        );
      
      let response = '';
      let imageData = '';
      
      // Если определили запрос на BPMN диаграмму, генерируем ее
      if (isBpmnRequest) {
        const bpmnResult = await chatApi.generateBpmnDiagram(input.trim());
        
        if (bpmnResult.success && bpmnResult.image) {
          response = "Вот созданная BPMN диаграмма на основе вашего описания:";
          imageData = bpmnResult.image;
        } else {
          response = `Не удалось создать BPMN диаграмму: ${bpmnResult.error || 'Неизвестная ошибка'}`;
        }
      } else {
        // Отправляем запрос на генерацию BPMN диаграммы, даже если не распознали явно
        // Это позволит модели самой решить, подходит ли запрос для создания диаграммы
        try {
          const bpmnResult = await chatApi.generateBpmnDiagram(input.trim());
          
          if (bpmnResult.success && bpmnResult.image) {
            response = "Я интерпретировал ваш запрос как просьбу создать BPMN диаграмму. Вот результат:";
            imageData = bpmnResult.image;
          } else {
            // Стандартный ответ для обычных сообщений
            response = "Кажется ващ запрос не связан с созданием диаграммы.";
          }
        } catch (error) {
          response = "Непридвиденная ошибка.";
        }
      }
      
      // Add assistant message to UI
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        image: imageData || undefined
      }
      
      setMessages(prev => [...prev, assistantMessage])
      
      // Save the message exchange to the database
      await chatApi.saveChatEntry({
        user_id: user.id,
        chat_id: chatId,
        message: input.trim(),
        response: response,
        image: imageData || undefined
      })
      
      // Если сообщений не было (первое сообщение в чате), обновляем название чата
      if (messages.length === 0 || (messages.length === 1 && messages[0].role === 'assistant')) {
        try {
          // Обрезаем длинные сообщения для названия чата
          const maxLength = 30
          let chatName = input.trim()
          
          if (chatName.length > maxLength) {
            chatName = chatName.substring(0, maxLength) + '...'
          }
          
          // Обновляем название чата
          await chatApi.updateChat(chatId, { name: chatName })
          console.log("Chat name updated to first message:", chatName)
        } catch (error) {
          console.error("Error updating chat name:", error)
        }
      }
    } catch (error) {
      console.error("Error processing message:", error)
      toast({
        title: "Ошибка",
        description: "Не удалось обработать сообщение",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Speech to text functions
  const startRecording = async () => {
    try {
      // Connect to WebSocket
      wsRef.current = new WebSocket('ws://localhost:8080/ws')
      
      wsRef.current.onopen = async () => {
        setSpeechStatus('Подключено. Запрашиваем доступ к микрофону...')
        
        try {
          // Получаем доступ к микрофону
          streamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            } 
          })
          
          // Создаем аудио контекст
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 48000
          })
          
          // Создаем источник из медиа-потока
          microphoneRef.current = audioContextRef.current.createMediaStreamSource(streamRef.current)
          
          // Создаем processor node для обработки аудио
          const CHUNK_SIZE = 4096
          processorRef.current = audioContextRef.current.createScriptProcessor(CHUNK_SIZE, 1, 1)
          
          processorRef.current.onaudioprocess = (e) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              // Получаем данные из буфера
              const inputData = e.inputBuffer.getChannelData(0)
              
              // Конвертируем float32 [-1.0,1.0] в int16 [-32768,32767]
              const intData = new Int16Array(inputData.length)
              for (let i = 0; i < inputData.length; i++) {
                // Клиппинг для безопасной конвертации
                const s = Math.max(-1, Math.min(1, inputData[i]))
                intData[i] = s < 0 ? s * 32768 : s * 32767
              }
              
              // Отправляем данные на сервер
              wsRef.current.send(intData.buffer)
            }
          }
          
          // Соединяем microphone -> processor -> destination
          microphoneRef.current.connect(processorRef.current)
          processorRef.current.connect(audioContextRef.current.destination)
          
          setSpeechStatus('Идет запись...')
          setIsRecording(true)
        } catch (err) {
          setSpeechStatus('')
          toast({
            title: "Ошибка доступа к микрофону",
            description: err instanceof Error ? err.message : "Неизвестная ошибка",
            variant: "destructive"
          })
          wsRef.current?.close()
        }
      }
      
      wsRef.current.onmessage = event => {
        const text = event.data
        setInput(prev => prev + (prev ? ' ' : '') + text)
      }
      
      wsRef.current.onerror = error => {
        console.error('WebSocket error:', error)
        setSpeechStatus('')
        toast({
          title: "Ошибка WebSocket соединения",
          variant: "destructive"
        })
      }
      
      wsRef.current.onclose = () => {
        setSpeechStatus('')
        if (isRecording) {
          stopRecording()
        }
      }
    } catch (err) {
      setSpeechStatus('')
      toast({
        title: "Ошибка",
        description: err instanceof Error ? err.message : "Неизвестная ошибка",
        variant: "destructive"
      })
    }
  }

  const stopRecording = () => {
    // Stop all audio processes
    if (processorRef.current && microphoneRef.current) {
      processorRef.current.disconnect()
      microphoneRef.current.disconnect()
      processorRef.current = null
      microphoneRef.current = null
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    setSpeechStatus('')
    setIsRecording(false)
  }

  // Toggle recording
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording()
    }
  }, [])

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Check if current user can interact with this chat
  const canInteract = Boolean(chatId && user?.id)

  // Update the message rendering to include images
  const renderMessage = (message: Message) => (
    <div
      key={message.id}
      className={`flex flex-col ${
        message.role === 'user' ? 'items-end' : 'items-start'
      } mb-4`}
    >
      <div
        className={`max-w-[80%] p-3 rounded-lg ${
          message.role === 'user'
            ? 'bg-blue-500 text-white rounded-tr-none'
            : 'bg-gray-200 text-gray-800 rounded-tl-none'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        
        {/* Render BPMN diagram image if present */}
        {message.image && (
          <div className="mt-2">
            <img 
              src={`data:image/png;base64,${message.image}`} 
              alt="BPMN diagram" 
              className="max-w-full rounded shadow-sm" 
            />
          </div>
        )}
      </div>
      <span className="text-xs text-gray-500 mt-1">
        {new Date(message.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-6 w-6 mr-2" />
            <span>Загрузка истории...</span>
          </div>
        ) : messages.length > 0 ? (
          messages.map(renderMessage)
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Начните новый разговор</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input form */}
      <div className="border-t p-4">
        {speechStatus && (
          <div className="text-sm text-primary mb-2 flex items-center">
            <div className="w-2 h-2 bg-primary rounded-full mr-2 animate-pulse"></div>
            {speechStatus}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canInteract ? "Введите сообщение..." : "Выберите чат для начала общения"}
            className="flex-1"
            disabled={!canInteract || isLoading}
          />
          
          <Button 
            type="button" 
            size="icon"
            variant="outline"
            onClick={toggleRecording}
            disabled={!canInteract || isLoading}
            className={isRecording ? 'bg-red-100 hover:bg-red-200 text-red-500' : ''}
          >
            {isRecording ? <XIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
          </Button>
          
          <Button 
            type="submit" 
            size="icon"
            disabled={!input.trim() || !canInteract || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <SendIcon className="h-5 w-5" />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
} 