import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import ClassroomDetail from "./pages/ClassroomDetail";
import Attendance from "./pages/Attendance";
import CourseDetail from "./pages/CourseDetail";
import StudentRegistration from "./pages/StudentRegistration";
import StudentPortal from "./pages/StudentPortal";
import LecturersPage from "./pages/LecturersPage";
import StudentsPage from "./pages/StudentsPage";
import Login from "./pages/Login";
import PendingApproval from "./pages/PendingApproval";
import AdminUsers from "./pages/AdminUsers";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/dashboard"
              element={<ProtectedRoute allowedRoles={["student", "lecturer", "admin"]}><Dashboard /></ProtectedRoute>}
            />

            <Route
              path="/classroom/:classId"
              element={<ProtectedRoute allowedRoles={["student", "lecturer", "admin"]}><ClassroomDetail /></ProtectedRoute>}
            />
            <Route
              path="/attendance"
              element={<ProtectedRoute allowedRoles={["student", "lecturer", "admin"]}><Attendance /></ProtectedRoute>}
            />
            <Route
              path="/attendance/course/:courseId"
              element={<ProtectedRoute allowedRoles={["lecturer", "admin"]}><CourseDetail /></ProtectedRoute>}
            />
            <Route
              path="/register/:token"
              element={<ProtectedRoute allowedRoles={["student"]}><StudentRegistration /></ProtectedRoute>}
            />
            <Route
              path="/my-attendance"
              element={<ProtectedRoute allowedRoles={["student"]}><StudentPortal /></ProtectedRoute>}
            />
            <Route path="/login" element={<Login />} />
            <Route path="/pending-approval" element={<PendingApproval />} />
            <Route
              path="/lecturers"
              element={<ProtectedRoute allowedRoles={["admin"]}><LecturersPage /></ProtectedRoute>}
            />
            <Route
              path="/students"
              element={<ProtectedRoute allowedRoles={["admin"]}><StudentsPage /></ProtectedRoute>}
            />
            <Route
              path="/admin/users"
              element={<ProtectedRoute allowedRoles={["admin"]}><AdminUsers /></ProtectedRoute>}
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
