import {exec} from "child_process";
import {defer} from "promised-io/promise";
import Version from "../Version";
import * as Exception from "../Exceptions";

/** Set of functions to interact with Grid Engine through CLI **/

/**
 * Get SGE version.
 */
export function getDrmsInfo() {
  let def = new defer();

  exec("qstat -help", (error, stdout, stderr) => {
    if (error) {
      def.reject(err);
      return;
    }
    let data = stdout.split("\n")[0].split(" ");    // The first line is the one containing the SGE version.
    let res = {drmsName: data[0]};                  // DRM name (SGE in this case)
    let vparts = data[1].split(".");                // Split into major and minor version number
    res.version = new Version(vparts[0],vparts[1]);
    def.resolve(res);
  });

  return def.promise;
}


/**
 * Function for invoking the qstat command of SGE.
 * @param jobId: id of the job on which qstat will be called (optional)
 */
export function qstat(jobId){
  let def = new defer();
  let args = "";

  if(jobId)
    args += "-j "+jobId;

  let command = "qstat " + args;

  console.log("Executing command: " + command);

  exec(command, (err, stdout, stderr) => {
    if (err) { def.reject(err) ; return; }

    let isSingleJobResult = !!jobId; // If qstat() is called with no parameters, equals to false

    let res = _parseQstatResult(stdout, isSingleJobResult);

    def.resolve(res);
  });

  return def.promise;

}

/**
 * Function for invoking the qsub command of SGE.
 * @param jobTemplate: contains all the job's parameters.
 */
export function qsub(jobTemplate){
  // Options for the exec fuctions; set the working directory specified in the jobTemplate.
  const opts = {
    cwd: jobTemplate.workingDirectory
  };

  let def = new defer();

  let args = _parseQsubOptions(jobTemplate);
  let command = "qsub " + args + " " + jobTemplate.remoteCommand + " " + jobTemplate.args.join(" ");

  // console.log("Executing command: " + command);

  exec(command, opts, (err, stdout, stderr) => {
    if (err) { def.reject(err) ; return; }
    def.resolve({stdout: stdout, stderr: stderr});
  });

  return def.promise;
}

/**
 * Function for invoking the qacct command of SGE.
 * @param jobId: the id of the job for which we want to retrieve information.
 */
export function qacct(jobId){
  let def = new defer();

  let args = "-j "+jobId;
  let command = "qacct " + args;

  console.log("Executing command: " + command);

  exec(command, (err, stdout, stderr) => {
    if (err) {
      // In order for a job to show up on qacct, some seconds have to pass after the job has finished,
      // hence the call to qacct might return an error complaining that the job can't be found if called to early.
      // We thus treat the "Job not found" error as a special state resolving the promise (instead of rejecting it)
      // with the "NOT FOUND" message.
      if(stderr.includes("error: job id " + jobId + " not found")){
        def.resolve("NOT FOUND");
      }
      else
        def.reject(err);
      return;
    }

    let res = _parseQacctResult(stdout);

    def.resolve(res);
  });
  return def.promise;
}

export function control(jobIds, action) {
  let def = new defer();

  const SUSPEND = 0, RESUME = 1, HOLD = 2, RELEASE = 3, TERMINATE = 4;

  jobIds = (jobIds && typeof jobIds==='string') ? jobIds : jobIds.join(",");

  let command = "";

  switch(action){
    case(SUSPEND):
      command = "qmod -sj " + jobIds;
      break;

    case(RESUME):
      command = "qmod -usj " + jobIds;
      break;

    case(HOLD):
      command = "qhold " + jobIds;
      break;

    case(RELEASE):
      command = "qrls " + jobIds;
      break;

    case(TERMINATE):
      command = "qdel " + jobIds;
      break;
  }

  exec(command, (err, stdout, stderr) => {
    if (err) { def.reject(err + stdout); return;  }

    def.resolve(stdout);

  });

  return def.promise;
}



/** ------------ HELPER FUNCTIONS -------------- **/

/**
 * Helper function that parses the options and arguments included in a jobTemplate.
 * @param jobTemplate
 * @returns {string} opts containing the formatted string with the specified options.
 * @private
 */
function _parseQsubOptions(jobTemplate){
  let opts = [];
  Object.keys(jobTemplate).forEach(function(key) {
    if (!jobTemplate[key]) {
      return;
    }

    switch (key) {
      case "workingDirectory":
        opts.push("-cwd");
        break;

      case "submitAsHold":
        opts.push("-h");
        break;

      case "jobEnvironment":
        opts.push("-v");
        let temp = [];
        Object.keys(jobTemplate[key]).forEach(function (envvar) {
          if(jobTemplate[key][envvar])
            temp.push(envvar + "=" + jobTemplate[key][envvar]);
          else
            temp.push(envvar);
        });
        opts.push(temp.join(","));
        break;

      case "email":
        if(jobTemplate[key].length!==0)
        {
          opts.push("-M ");
          let temp = [];
          jobTemplate[key].forEach(function (addr) {
            temp.push(addr);
          });
          opts.push(temp.join(","));
        }
        break;

      case "blockEmail":
        opts.push("-m");
        opts.push("n");
        break;

      case "jobName":
        opts.push("-N");
        opts.push(jobTemplate[key]);
        break;

      case "inputPath":
        opts.push("-i");
        opts.push(jobTemplate[key]);
        break;

      case "outputPath":
        opts.push("-o");
        opts.push(jobTemplate[key]);
        break;

      case "errorPath":
        opts.push("-e");
        opts.push(jobTemplate[key]);
        break;

      case "joinFiles":
        opts.push("-j");
        break;

      case "remoteCommand":
      case "args":
        break;

      case "startTime":
        opts.push("-a");
        opts.push(jobTemplate[key]);
        break;

      case "nativeSpecification":
        jobTemplate[key].split(" ").forEach(function (i) {
          // These attributes are not supported in the DRMAA.
          if(i==="-help" || i==="-sync" || i==="-t" || i==="-verify" || i==="-w")
            throw new Exception.UnsupportedAttributeException("The attribute "+i+" is not supported");
          else
            opts.push(i);
        });
        break;

      default:
        console.log("Ignoring Template Property: ", key);
    }
  });

  // console.log("opts: " + opts);

  return opts.join(" ");
}

/**
 * Helper function that parses the result of a qstat function invocation.
 * @param result: the result of the qstat command
 * @param isSingleJobResult: whether the result refers to a single job
 * @returns jobs: object containing the parsed result
 * @private
 */
function _parseQstatResult(result, isSingleJobResult){
  let jobs = {};
  if(!isSingleJobResult)
  {
    // split the output in lines, omitting the first two since they carry no information, and remove the empty lines.
    let lines = result.split("\n").slice(2).filter((line) => { return line!==""});
    lines.forEach((line) => {
      let prop = line.split(" ").filter((word) => { return word!=="" });
      jobs[prop[0]] = {
        jobId: prop[0],
        jobName: prop[2],
        jobState: prop[4],
        submitDate: prop[5] + " " + prop[6]
      }
    })
  }
  else
  {
    let job = {};
    let lines = result.split("\n").slice(1).filter((line) => { return line!==""});
    lines.forEach((line) => {
      let key = line.split(":",1)[0];
      let value = line.slice(key.length+1).trim();

      // Group together multiple error reasons (normally they would be listed as "error reason 1", "error reason 2" etc)
      if(key.includes("error reason")){
        key = "error_reason";
        job[key] = job[key] ? job[key].push(value) : [value]
      }
      else
        job[key] = value;
    });

    jobs = job;
  }
  // console.log(jobs);
  return jobs;

}

/**
 * Helper function that parses the result of a qacct function invocation.
 * @param result: the result of the qacct command
 * @returns jobInfo: object containing the parsed result
 * @private
 */
function _parseQacctResult(result){
  let jobInfo = {};
  let lines = result.split("\n").slice(1).filter((line) => { return line!==""});
  lines.forEach((line) => {
    let key = line.split(" ",1)[0];
    let value = line.slice(key.length).trim();
    jobInfo[key] = value;
  });
  // console.log(jobInfo);
  return jobInfo;
}
