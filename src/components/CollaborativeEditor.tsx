import React, { useState, useEffect, useRef, useCallback } from 'react'
import { blink } from '../blink/client'
import { Users, Save, Circle } from 'lucide-react'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface User {
  id: string
  email: string
  displayName?: string
}

interface CursorPosition {
  userId: string
  position: number
  displayName: string
  color: string
}

interface DocumentData {
  id: string
  title: string
  content: string
  userId: string
  createdAt: string
  updatedAt: string
}

const CURSOR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', 
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'
]

export default function CollaborativeEditor() {
  const [user, setUser] = useState<User | null>(null)
  const [document, setDocument] = useState<DocumentData | null>(null)
  const [title, setTitle] = useState('Untitled Document')
  const [content, setContent] = useState('')
  const [onlineUsers, setOnlineUsers] = useState<any[]>([])
  const [cursors, setCursors] = useState<CursorPosition[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const documentId = 'default-doc' // For demo purposes

  // Initialize auth and document
  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      if (state.user) {
        loadDocument()
        setupRealtime()
      }
    })
    return unsubscribe
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDocument = async () => {
    try {
      // Try to load existing document or create new one
      const docs = await blink.db.documents.list({
        where: { id: documentId },
        limit: 1
      })
      
      if (docs.length > 0) {
        const doc = docs[0]
        setDocument(doc)
        setTitle(doc.title)
        setContent(doc.content)
      } else {
        // Create new document
        const newDoc = await blink.db.documents.create({
          id: documentId,
          title: 'Untitled Document',
          content: '',
          userId: user?.id || 'anonymous'
        })
        setDocument(newDoc)
        setTitle(newDoc.title)
        setContent(newDoc.content)
      }
    } catch (error) {
      console.error('Error loading document:', error)
      // Fallback to local state
      setTitle('Untitled Document')
      setContent('')
    }
  }

  const setupRealtime = async () => {
    if (!user) return

    try {
      const channel = blink.realtime.channel(`document-${documentId}`)
      
      await channel.subscribe({
        userId: user.id,
        metadata: {
          displayName: user.email?.split('@')[0] || 'Anonymous',
          color: CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
        }
      })

      // Listen for content changes
      channel.onMessage((message) => {
        if (message.type === 'content-change' && message.userId !== user.id) {
          setContent(message.data.content)
        }
        if (message.type === 'title-change' && message.userId !== user.id) {
          setTitle(message.data.title)
        }
        if (message.type === 'cursor-move' && message.userId !== user.id) {
          setCursors(prev => {
            const filtered = prev.filter(c => c.userId !== message.userId)
            return [...filtered, {
              userId: message.userId,
              position: message.data.position,
              displayName: message.metadata?.displayName || 'Anonymous',
              color: message.metadata?.color || '#3b82f6'
            }]
          })
        }
      })

      // Listen for presence changes
      channel.onPresence((users) => {
        setOnlineUsers(users)
        setIsConnected(true)
      })

      setIsConnected(true)
    } catch (error) {
      console.error('Error setting up realtime:', error)
      setIsConnected(false)
    }
  }

  const saveDocument = useCallback(async () => {
    if (!user || !document) return

    setIsSaving(true)
    try {
      await blink.db.documents.update(document.id, {
        title,
        content,
        updatedAt: new Date().toISOString()
      })
      setLastSaved(new Date())
    } catch (error) {
      console.error('Error saving document:', error)
    } finally {
      setIsSaving(false)
    }
  }, [user, document, title, content])

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(saveDocument, 1000)
  }, [saveDocument])

  const handleContentChange = async (newContent: string) => {
    setContent(newContent)
    debouncedSave()

    // Broadcast change to other users
    if (user && isConnected) {
      try {
        await blink.realtime.publish(`document-${documentId}`, 'content-change', {
          content: newContent,
          timestamp: Date.now()
        })
      } catch (error) {
        console.error('Error broadcasting content change:', error)
      }
    }
  }

  const handleTitleChange = async (newTitle: string) => {
    setTitle(newTitle)
    debouncedSave()

    // Broadcast title change
    if (user && isConnected) {
      try {
        await blink.realtime.publish(`document-${documentId}`, 'title-change', {
          title: newTitle,
          timestamp: Date.now()
        })
      } catch (error) {
        console.error('Error broadcasting title change:', error)
      }
    }
  }

  const handleCursorMove = async () => {
    if (!textareaRef.current || !user || !isConnected) return

    const position = textareaRef.current.selectionStart
    
    try {
      await blink.realtime.publish(`document-${documentId}`, 'cursor-move', {
        position,
        timestamp: Date.now()
      })
    } catch (error) {
      console.error('Error broadcasting cursor position:', error)
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Connecting to editor...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 flex-1">
              <Input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="text-lg font-medium border-none shadow-none focus-visible:ring-0 px-0 max-w-md"
                placeholder="Untitled Document"
              />
              
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <Circle 
                  className={`w-2 h-2 fill-current ${
                    isConnected ? 'text-green-500' : 'text-red-500'
                  }`} 
                />
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                
                {isSaving && (
                  <>
                    <span>•</span>
                    <span>Saving...</span>
                  </>
                )}
                
                {lastSaved && !isSaving && (
                  <>
                    <span>•</span>
                    <span>Saved {lastSaved.toLocaleTimeString()}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Online Users */}
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-gray-500" />
                <div className="flex -space-x-2">
                  {onlineUsers.slice(0, 5).map((user, index) => (
                    <Avatar key={user.userId} className="w-8 h-8 border-2 border-white">
                      <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                        {user.metadata?.displayName?.[0]?.toUpperCase() || 'A'}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {onlineUsers.length > 5 && (
                    <div className="w-8 h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-xs text-gray-600">
                      +{onlineUsers.length - 5}
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className="ml-2">
                  {onlineUsers.length} online
                </Badge>
              </div>

              <Button onClick={saveDocument} disabled={isSaving} size="sm">
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Editor */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onSelect={handleCursorMove}
            onKeyUp={handleCursorMove}
            onClick={handleCursorMove}
            placeholder="Start typing to begin collaborating..."
            className="w-full min-h-[600px] p-6 text-base leading-relaxed border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          />
          
          {/* Live Cursors */}
          {cursors.map((cursor) => (
            <div
              key={cursor.userId}
              className="absolute pointer-events-none z-20"
              style={{
                left: '24px', // Approximate position - in a real implementation, you'd calculate this based on text metrics
                top: `${Math.min(cursor.position * 0.1, 500)}px`, // Simplified positioning
              }}
            >
              <div
                className="w-0.5 h-5 animate-pulse"
                style={{ backgroundColor: cursor.color }}
              />
              <div
                className="absolute -top-6 left-0 px-2 py-1 text-xs text-white rounded whitespace-nowrap"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.displayName}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}