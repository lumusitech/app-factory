import type { AssignmentRepository } from '../domain/assignment-repository.js';
import type { ClassAttendanceRepository } from '../domain/class-attendance-repository.js';
import type { ClassSessionRepository } from '../domain/class-session-repository.js';
import type { ClassTopicRepository } from '../domain/class-topic-repository.js';
import type { EvaluationRepository } from '../domain/evaluation-repository.js';
import type { GradeSheetRepository } from '../domain/grade-sheet-repository.js';
import type { TopicRepository } from '../domain/topic-repository.js';
import type { TrajectoryAssessmentRepository } from '../domain/trajectory-assessment-repository.js';

/**
 * Bag de repositorios por agregado (D6) que el borde consume dentro de la unidad
 * de trabajo (F-01/F-02/F-03; ADR 0011/0012/0013). Un puerto por agregado, nunca
 * `Repository<T>`.
 */
export interface TeacherRepositories {
  readonly classes: ClassSessionRepository;
  readonly topics: TopicRepository;
  readonly classTopics: ClassTopicRepository;
  readonly assignments: AssignmentRepository;
  readonly attendances: ClassAttendanceRepository;
  readonly evaluations: EvaluationRepository;
  readonly gradeSheets: GradeSheetRepository;
  readonly trajectoryAssessments: TrajectoryAssessmentRepository;
}
