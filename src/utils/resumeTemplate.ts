import { ResumeData } from "@/types/resume";

/**
 * Creates an empty ResumeData template with default values
 */
export function createEmptyResumeTemplate(): ResumeData {
  return {
    profile: {
      name: "",
      surname: "",
      email: "",
      headline: "",
      professionalSummary: "",
      linkedIn: null,
      website: null,
      country: "",
      city: "",
      relocation: false,
      remote: false,
    },
    workExperiences: [],
    educations: [],
    skills: [],
    licenses: [],
    languages: [],
    achievements: [],
    publications: [],
    honors: [],
  };
}
