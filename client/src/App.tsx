import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/features/auth/LoginPage'
import RegisterPage from '@/features/auth/RegisterPage'
import WhiteboardListPage from '@/features/whiteboard/WhiteboardListPage'
import WhiteboardPage from '@/features/whiteboard/WhiteboardPage'
import ProtectedRoute from '@/components/ui/ProtectedRoute'

function AppContent() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/whiteboards"
        element={
          <ProtectedRoute>
            <WhiteboardListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/whiteboard/:id"
        element={
          <ProtectedRoute>
            <WhiteboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/whiteboards" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App