
export default class JobInfo{
  constructor()
  {
    // Make sure that this class can't be constructed directly but only through subclasses
    if (new.target === JobInfo) {
      throw new TypeError("Cannot construct JobInfo instances from its abstract class.");
    }

    this.jobId = null;      // Job id
    this.exitStatus = null; // exit code
    this.failed = false;    // Failure code
    this.rawInfo = {};      // Contains all the information obtained from qacct
  }

  getExitStatus(){ return this.hasExited() ? this.exitStatus : null; }

  getJobId(){ return this.jobId; }

  hasExited(){ return !!this.exitStatus; }
}