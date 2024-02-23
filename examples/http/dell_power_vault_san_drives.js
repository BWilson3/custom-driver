/**
 * Domotz Custom Driver 
 * Name: Dell PowerVault SAN Drives
 * Description: This script retrieves information about the drives of a Dell PowerVault SAN system using the Redfish API.
 * 
 * Communication protocol is HTTPS
 * 
 * Tested on Dell PowerVault ME5024
 *
 * Creates a Custom Driver table with the following columns:
 *      - Serial Number: The serial number of the drive
 *      - Rack: The rack where the drive is located
 *      - Rack Offset: The offset of the drive within the rack
 *      - Health: The health status of the drive
 **/

var sessionToken;

var table = D.createTable(
    "Drives",[
        { label: "Serial Number", valueType: D.valueType.STRING },
        { label: "Rack", valueType: D.valueType.NUMBER },
        { label: "Rack Offset", valueType: D.valueType.NUMBER },
        { label: "Health", valueType: D.valueType.STRING }
    ]
);

// Process the response from the server
function processResponse(d) {
    return function process(error, response, body) {  
        if (error) {          
            console.error(error);
            D.failure(D.errorType.GENERIC_ERROR);
        }      
        if (response.headers["x-auth-token"]) {
            sessionToken = response.headers["x-auth-token"];
        } else if (response.headers && response.headers["command-status"] && response.headers["command-status"].indexOf("Command failed") !==-1) {
            console.error("Session token not found in response headers");
            D.failure(D.errorType.AUTHENTICATION_ERROR);
        } else if (response.headers && response.headers["command-status"] && response.headers["command-status"].indexOf("Invalid URL") !==-1) {
            console.error("Invalid URL");
            D.failure(D.errorType.RESOURCE_UNAVAILABLE);
        } else if (response.statusCode !== 200) {
            D.failure(D.errorType.GENERIC_ERROR);
        } 
        d.resolve(JSON.parse(body));
    };
}

/**
 * Logs in to the Dell PowerVault SAN system
 * @returns A promise object representing the login process
 */
function login() {
    var d = D.q.defer();
    var config = {
        url: "/redfish/v1/SessionService/Sessions/",
        protocol: "https",
        jar: true,
        rejectUnauthorized: false,
        body: JSON.stringify({
            "UserName": D.device.username(),
            "Password": D.device.password() 
        })
    };
    D.device.http.post(config, processResponse(d));
    return d.promise;
}

/**
 * Sends an HTTP GET request
 * @param {string} url The URL to perform the GET request
 * @returns promise for http response body
 */
function httpGet(url) {
    var d = D.q.defer();
    var config = {
        url:url,
        protocol: "https",
        jar: true,
        rejectUnauthorized: false,
        headers: {
            'X-Auth-Token': sessionToken,
        }
    };
    D.device.http.get(config, processResponse(d));
    return d.promise;
}

// Function to make an HTTP GET request to retrieve controllers from the Dell PowerVault SAN system
function getControllers(){
    return httpGet("/redfish/v1/Storage")
        .then(function(controllers){
            if (controllers && controllers.Members) {
                var promises = controllers.Members.map(function (member) {
                    return getControllerInfo(member['@odata.id']);
                });
                return D.q.all(promises);
            }
        });
}

/**
 * Retrieves information about a specific controller
 * @param {string} controllerUrl The URL of the controller
 * @returns A promise representing the retrieval of controller information
 */
function getControllerInfo(controllerUrl) {
    return httpGet(controllerUrl)
        .then(function(controller) {
            if (controller && controller.Name && controller.Drives) {
                var drivePromises = controller.Drives.map(function(drive) {
                    return getDriveInfo(drive['@odata.id'], controller.Name);
                });
                return D.q.all(drivePromises);
            } else {
                console.error("Controller name or drives not found");
            }
        })
        .catch(function(err) {
            console.error("Error retrieving controller info " + err);
            D.failure(D.errorType.GENERIC_ERROR);
        });
}

/**
 * Retrieves information about specific drive
 * @param {string} driveUrl The URL of the drive
 * @param {string} controllerName The name of the controller the drive belongs to
 * @returns A promise representing the retrieval of drives information
 */
function getDriveInfo(driveUrl, controllerName) {
    return httpGet(driveUrl)
        .then(function(drive) {
            if (drive && drive.Name) {
                return { controllerName: controllerName, drive: drive };
            } else {
                console.error("Drive name not found");
            }
        })
        .catch(function(err) {
            console.error("Error retrieving drive info: " + err);
            D.failure(D.errorType.GENERIC_ERROR);
        });
}

function sanitize(output){
    var recordIdReservedWords = ['\\?', '\\*', '\\%', 'table', 'column', 'history'];
    var recordIdSanitisationRegex = new RegExp(recordIdReservedWords.join('|'), 'g');
    return output.replace(recordIdSanitisationRegex, '').slice(0, 50).replace(/\s+/g, '-').toLowerCase();
}

function extractData(data) {
    data.forEach(function(driveData) {
        driveData.forEach(function(drives){
            var controllerName = drives.controllerName;
            var drive = drives.drive;
            if (!controllerName || !drive) {
                console.error("Controller name or drive not found");
                D.failure(D.errorType.GENERIC_ERROR);
            }
            var name = drive.Name;
            var serialNumber = drive.SerialNumber;
            var rack = drive.PhysicalLocation.Placement.Rack;
            var rackOffset = drive.PhysicalLocation.Placement.RackOffset;
            var health = drive.Status.State == "Enabled" ? drive.Status.Health : "N/A";
            var recordId = sanitize(controllerName + " " + name); 
            table.insertRecord(recordId, [
                serialNumber,
                rack, 
                rackOffset,
                health
            ]);    
        });     
    });
    D.success(table);
}

/**
 * @remote_procedure
 * @label Validate Dell PowerVault device
 * @documentation This procedure is used to validate the presence of a Dell PowerVault device by checking the availability of a specific Redfish API endpoint
 */
function validate(){
    login()
        .then(getControllers)
        .then(function(response) {
            if (response && response.length > 0) {
                console.log("Validation successful");
                D.success();
            } else {
                console.error("Validation failed");
                D.failure(D.errorType.PARSING_ERROR);
            }
        })
        .catch(function(err) {
            console.error(err);
            D.failure(D.errorType.GENERIC_ERROR);
        });
}


/**
 * @remote_procedure
 * @label Get Drives
 * @documentation This procedure is used to extract information about a specific drvice from the Dell PowerVault SAN system
 */
function get_status() {
    login()
        .then(getControllers)
        .then(extractData)
        .catch(function (err) {
            console.error(err);
            D.failure(D.errorType.GENERIC_ERROR);
        });
}