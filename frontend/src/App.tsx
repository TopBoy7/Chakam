import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import ClassroomDetail from "./pages/ClassroomDetail";
import Attendance from "./pages/Attendance";
import CourseDetail from "./pages/CourseDetail";
import StudentRegistration from "./pages/StudentRegistration";
import StudentPortal from "./pages/StudentPortal";
import LecturersPage from "./pages/LecturersPage";
import StudentsPage from "./pages/StudentsPage";
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
            <Route path="/dashboard" element={<Dashboard />} />

            <Route path="/classroom/:classId" element={<ClassroomDetail />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/attendance/course/:courseId" element={<CourseDetail />} />
            <Route path="/register/:token" element={<StudentRegistration />} />
            <Route path="/my-attendance" element={<StudentPortal />} />
            <Route path="/lecturers" element={<LecturersPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
