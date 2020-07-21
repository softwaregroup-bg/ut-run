/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/error.test.js TAP Error import test.error.throw > error with properties 1`] = `
Object {
  "message": "Module foo error with additional properties",
  "statusCode": 400,
  "type": "foo.properties",
}
`

exports[`test/error.test.js TAP Error import test.error.throw > module bar simple error 1`] = `
Object {
  "cause": Error: root,
  "message": "Module bar simple error",
  "type": "bar.simple",
}
`

exports[`test/error.test.js TAP Error import test.error.throw > module foo simple error 1`] = `
Object {
  "message": "Module foo simple error",
  "type": "foo.simple",
}
`

exports[`test/error.test.js TAP Error import test.error.throw > parametrized error message 1`] = `
Object {
  "message": "Module bar parametrized error: value",
  "params": Object {
    "name": "value",
  },
  "type": "bar.parametrized",
}
`
