module.exports = (config, schema) => {
    return `
        <!DOCTYPE HTML>
        <html>
        <head>
        <title>ut-run config editor</title>
        <link href="jsoneditor/dist/jsoneditor.css" rel="stylesheet" type="text/css">
        <script src="jsoneditor/dist/jsoneditor.js"></script>
        <link href="static/style.css" rel="stylesheet" type="text/css">
        <script type="text/javascript">
            window.ut = {
                config: ${JSON.stringify(config)},
                schema: ${JSON.stringify(schema)}
            }
        </script>
        <script src="static/script.js"></script>
        </head>
        <body>
            <div id="jsoneditor"></div>
            <div id="result">
                <div id="generate" style="margin: 20px 0;">
                    <span>generate:</span>
                </div>
                <div id="output"><pre></pre></div>
            </div>
        </body>
        </html>
    `;
};
