import type { ConfigEntryRepository } from '@kernel/config';

import type { AssignmentRepository } from '../domain/assignment-repository.js';
import type { ClassAttendanceRepository } from '../domain/class-attendance-repository.js';
import type { ClassSessionRepository } from '../domain/class-session-repository.js';
import type { ClassTopicRepository } from '../domain/class-topic-repository.js';
import type { EvaluationRepository } from '../domain/evaluation-repository.js';
import type { GradeSheetRepository } from '../domain/grade-sheet-repository.js';
import type { PeriodClosingRepository } from '../domain/period-closing-repository.js';
import type { TopicRepository } from '../domain/topic-repository.js';
import type { TrajectoryAssessmentRepository } from '../domain/trajectory-assessment-repository.js';
import type { OfficialSheetReadModel } from '../persistence/official-sheet-read-model.js';
import type { PeriodClosingReadModel } from '../persistence/period-closing-read-model.js';
import type { DailyWorksheetReadModel } from '../persistence/daily-worksheet-read-model.js';
import type { StudentRecordRepository } from '../domain/student-record-repository.js';

/**
 * Bag de repositorios por agregado (D6) que el borde consume dentro de la unidad
 * de trabajo (F-01/F-02/F-03; ADR 0011/0012/0013). Un puerto por agregado, nunca
 * `Repository<T>`.
 *
 * F-04 (ADR 0014) suma dos entradas que **no** son agregados de la planilla
 * (vista derivada, T6): el **read model** de la planilla (lectura cross-agregado)
 * y el repositorio de **configuración** del tenant (D19/ADR 0007; la plantilla).
 *
 * La planilla de uso diario (ADR 0017) suma su propio **read model** cross-agregado
 * (asistencia por fecha + actividades + valoración + cierre + evolución); sigue
 * siendo una vista derivada (T6), no un agregado.
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
  readonly officialSheet: OfficialSheetReadModel;
  readonly config: ConfigEntryRepository;
  readonly studentRecords: StudentRecordRepository;
  readonly periodClosings: PeriodClosingRepository;
  readonly periodClosingView: PeriodClosingReadModel;
  readonly dailyWorksheet: DailyWorksheetReadModel;
}
