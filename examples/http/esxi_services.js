/**
 * Domotz Custom Driver
 * Name: ESXi Services
 * Description: Monitors the ESXi host Services.
 *
 * Communication protocol is HTTPS
 *
 * Tested on ESXi version: 8.0.0
 *
 * Output:
 * Extracts the following information from the data array:
 * - ID
 * - Name
 * - Is Required
 * - Is Uninstallable
 * - Is Running
 * - Policy
 *
 **/

// URL endpoint for accessing the vSphere SDK
const url = '/sdk'

// Creation of Services table
var servicesTable = D.createTable(
    'Services Details',
    [
      { label: 'Name', valueType: D.valueType.STRING },
      { label: 'Is Required', valueType: D.valueType.STRING },
      { label: 'Is Uninstallable', valueType: D.valueType.STRING },
      { label: 'Is Running', valueType: D.valueType.STRING },
      { label: 'Policy', valueType: D.valueType.STRING }
    ]
)

/**
 * Sends a SOAP request and returns a promise with the parsed response.
 * @param {string} body  The SOAP request body.
 * @param {function} extractData  A call back function to extract data from body and response.
 * @returns A promise that resolves with the parsed response.
 */
function sendSoapRequest (body, extractData) {
  const d = D.q.defer()

  let config ={
    url,
    protocol: "https",
    rejectUnauthorized: false,
    body,
    jar: true
  }

  D.device.http.post(config, function (error, response, body) {
    if (error) {
      console.error(error)
      D.failure(D.errorType.GENERIC_ERROR)
    } else if (!response) {
      D.failure(D.errorType.RESOURCE_UNAVAILABLE)
    } else if (response.statusCode === 400) {
      D.failure(D.errorType.AUTHENTICATION_ERROR)
    } else if (response.statusCode !== 200) {
      D.failure(D.errorType.GENERIC_ERROR)
    } else {
      const result = extractData(body)
      d.resolve(result)
    }
  })
  return d.promise
}

/**
 * Constructs a SOAP payload with the given body content.
 * @param {string} soapBody - The content to be included in the SOAP body.
 * @returns {string} The complete SOAP payload as a string, including the envelope and body.
 */
function createSoapPayload (soapBody) {
  return '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:vim25="urn:vim25"><soapenv:Body>'
      + soapBody +
      '</soapenv:Body></soapenv:Envelope>'
}

/**
 * Parses the SOAP response to extract the Session Key.
 * @param {string} soapResponse - The SOAP response as a string.
 * @returns {string} The Session Key extracted from the SOAP response.
 */
function getSessionKey(soapResponse) {
  const $ = D.htmlParse(soapResponse)
  return $('returnval').find('key').first().text()
}

/**
 * Constructs and sends a SOAP login request to the ESXi server.
 * @returns {Promise} A promise that resolves with the response of the login request.
 */
function login () {
  const payload = createSoapPayload(
      '<vim25:Login>' +
      '   <_this type="SessionManager">ha-sessionmgr</_this>' +
      '   <userName>' + D.device.username() + '</userName>' +
      '   <password>' + D.device.password() + '</password>' +
      '</vim25:Login>'
  )
  // Send the SOAP request and handle the response to extract the cookie Session Key.
  return sendSoapRequest(payload, getSessionKey)
}

/**
 * Parses the SOAP response to extract the container ID.
 * @param {string} soapResponse - The SOAP response as a string.
 * @returns {string} The container ID extracted from the SOAP response.
 */
function getContainerIdFromSoap(soapResponse) {
  const $ = D.htmlParse(soapResponse)
  return $('returnval').text();
}

/**
 * Constructs and sends a SOAP request to create a container view for all host systems.
 * @returns {Promise} A promise that resolves with the container ID from the SOAP response.
 */
function createAllHostContainer() {
  const payload = createSoapPayload(
      '<CreateContainerView xmlns="urn:vim25">' +
      '    <_this type="ViewManager">ViewManager</_this>' +
      '    <container type="Folder">ha-folder-root</container>' +
      '    <type>HostSystem</type>' +
      '    <recursive>true</recursive>' +
      '</CreateContainerView>'
  )
  // Send the SOAP request and extract the container ID from the response.
  return sendSoapRequest(payload, getContainerIdFromSoap)
}

/**
 * Extracts the host reference from the SOAP response.
 * @param {string} soapResponse - The SOAP response as a string.
 * @returns {string} The host reference extracted from the SOAP response.
 */
function getHostRefFromSoap(soapResponse) {
  const $ = D.htmlParse(soapResponse)
  return $('returnval').find('ManagedObjectReference').first().text()
}

/**
 * Constructs and sends a SOAP request to fetch details from a container view by its ID.
 * @param {string} containerId - The ID of the container view to fetch.
 * @returns {Promise} A promise that resolves with the host reference extracted from the SOAP response.
 */
function fetchContainer(containerId) {
  const payload = createSoapPayload(
      '<Fetch xmlns="urn:vim25">' +
      '    <_this type="ContainerView">' + containerId + '</_this>' +
      '    <prop>view</prop>' +
      '</Fetch>'
  )
  // Send the SOAP request and extract the host reference from the response.
  return sendSoapRequest(payload, getHostRefFromSoap)
}

/**
 * Constructs and sends a SOAP request to retrieve properties for a specified host reference.
 * @param {string} hostRef - The reference ID of the host whose properties are to be retrieved.
 * @returns {Promise} A promise that resolves with the properties of the host as extracted from the SOAP response.
 */
function retrieveProprieties(hostRef) {
  const payload = createSoapPayload(
      '<RetrieveProperties xmlns="urn:vim25">' +
      '    <_this type="PropertyCollector">ha-property-collector</_this>' +
      '    <specSet>' +
      '        <propSet>' +
      '            <type>HostSystem</type>' +
      '            <pathSet>config.service</pathSet>' +
      '        </propSet>' +
      '        <objectSet>' +
      '            <obj type="HostSystem">' + hostRef + '</obj>' +
      '        </objectSet>' +
      '    </specSet>' +
      '</RetrieveProperties>'
  )
  // Send the SOAP request and handle the response to generate the desired variables.
  return sendSoapRequest(payload, generateTabelOutput)
}

/**
 * Populates a table with services.
 */
function populateTable (serviceDetails) {
  servicesTable.insertRecord(serviceDetails.id, [
    serviceDetails.name,
    serviceDetails.isRequired,
    serviceDetails.isUninstallable,
    serviceDetails.isRunning,
    serviceDetails.policy
  ]);
}

/**
 * Parses the SOAP response and generates variables from the retrieved properties.
 * @param {string} soapResponse - The SOAP response as a string.
 * @returns {Array} the output tabel created from the extracted properties.
 */
function generateTabelOutput(soapResponse) {
  const $ = D.htmlParse(soapResponse);
  let i = 1
  $('propSet:has(name:contains("config.service")) val service').each(function() {
    const service = $(this);
    populateTable({
      "id": service.find('key').text(),
      "name": service.find('label').text() || "N/A",
      "isRequired": service.find('required').text() || "N/A",
      "isUninstallable": service.find('uninstallable').text() || "N/A",
      "isRunning": service.find('running').text() || "N/A",
      "policy": service.find('policy').text() || "N/A",
    })
  });
  return servicesTable;
}

/**
 * @remote_procedure
 * @label Validate Association
 * @documentation This procedure is used to validate if the driver can be applied on a device during association as well as validate any credentials provided
 */
function validate () {
  login()
      .then(function (sessionKey) {
        if(sessionKey && sessionKey.length > 0){
          D.success();
        }
      })
      .catch(function () {
        D.failure(D.errorType.GENERIC_ERROR);
      });
}

/**
 * @remote_procedure
 * @label Get ESXi host Services
 * @documentation This procedure retrieves the ESXi host Services
 */
function get_status() {
  login().
  then(createAllHostContainer).
  then(fetchContainer).
  then(retrieveProprieties).
  then(D.success)
      .catch(function (err) {
        console.error(err);
        D.failure(D.errorType.GENERIC_ERROR);
      });
}