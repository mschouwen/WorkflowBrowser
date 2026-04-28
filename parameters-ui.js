(function () {
    const WorkflowApp = window.WorkflowApp;
    const cy = WorkflowApp.cy;
    const cyContainer = WorkflowApp.cyContainer;

    const defaultIcons = {
        'numericdomain': 'numericdomain.png',
        'textdomain': 'textdomain.png',
        'rastercoverage': 'raster.png',
        'vector': 'vector.png',
        'table': 'table.png',
        'georeferece': 'georeference.png',
        'coordinatesystem': 'coordinatesystem.png',
        'string': 'text.png',
        'int64': 'numbers20.png',
        'signedbyte': 'numbers20.png',
        'byte': 'numbers20.png',
        'uint16': 'numbers20.png',
        'int16': 'numbers20.png',
        'uint32': 'numbers20.png',
        'int32': 'numbers20.png',
        'uint64': 'numbers20.png',
        'real32': 'numbers20.png',
        'real64': 'numbers20.png',
        'date': 'text.png',
        'time': 'text.png',
        'unknown': 'choice.png',
        'itemdomain': 'itemdomain.png',
        'operation': 'operation.png',
        'ellipsoid': 'ellipsoid.png',
        'projection': 'projection.png',
        'point': 'vector_point.png',
        'line': 'vector_line.png',
        'polygon': 'vector_fill.png',
        'colordomain': 'colordom.png',
        'text': 'text.png',
        'bool': 'bool20.png'
    };

    let cachedIcons = null;
    let iconsFetchPromise = null;

    async function ensureIconsLoaded() {
        if (cachedIcons) {
            return cachedIcons;
        }
        if (iconsFetchPromise) {
            return iconsFetchPromise;
        }

        iconsFetchPromise = fetch('/api/icons')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load icons: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                cachedIcons = data?.icons && typeof data.icons === 'object' ? data.icons : defaultIcons;
                return cachedIcons;
            })
            .catch(error => {
                console.warn('Using fallback icon mapping, server icon list unavailable.', error);
                cachedIcons = defaultIcons;
                return cachedIcons;
            })
            .finally(() => {
                iconsFetchPromise = null;
            });

        return iconsFetchPromise;
    }

    function getIconHtml(datatype) {
        const icons = cachedIcons || defaultIcons;

        if (!datatype || datatype === '?') return '';
        if (datatype.includes('|')) {
            const parts = datatype.split('|').map(t => t.trim()).filter(t => t && t !== '?');
            const p1 = parts.map(t => icons[t]);
            const p2 = [...new Set(p1)];
            return p2.map(t => `<img class="datatype-icon datatype-icon-spaced" src="/images/${t || icons['unknown']}"/>`).join('');
        }
        return `<img class="datatype-icon" src="/images/${icons[datatype] || icons['unknown']}"/>`;
    }

    function getParameterUiName(param, fallbackName) {
        return param?.UIname || param?.UIName || param?.name || fallbackName || 'Unnamed parameter';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseParameterValueSet(param) {
        const rawValueSet = String(param?.valueset ?? '').trim();
        if (!rawValueSet) {
            return { options: [], defaultValue: '' };
        }

        let defaultValue = '';
        const options = rawValueSet
            .split('|')
            .map((entry) => String(entry ?? '').trim())
            .filter((entry) => entry !== '')
            .map((entry) => {
                const isDefault = entry.startsWith('!');
                const value = isDefault ? entry.slice(1).trim() : entry;

                if (isDefault && defaultValue === '') {
                    defaultValue = value;
                }

                return value;
            })
            .filter((entry) => entry !== '');

        return { options, defaultValue };
    }

    function createValueSetInputHtml(param, key, currentValue = '', className = 'param-fixed-value', placeholder = 'Fixed value') {
        const valueSet = parseParameterValueSet(param);
        const normalizedCurrentValue = String(currentValue ?? '');
        const escapedClassName = escapeHtml(className);
        const escapedPlaceholder = escapeHtml(placeholder);

        if (valueSet.options.length === 0) {
            return `<input type="text" class="${escapedClassName}" data-parameter-key="${escapeHtml(key)}" value="${escapeHtml(normalizedCurrentValue)}" placeholder="${escapedPlaceholder}" />`;
        }

        const hasSavedValue = normalizedCurrentValue !== '' && valueSet.options.includes(normalizedCurrentValue);
        const selectedValue = hasSavedValue
            ? normalizedCurrentValue
            : (valueSet.defaultValue || valueSet.options[0]);
        const optionHtml = valueSet.options
            .map((option) => {
                const escapedOption = escapeHtml(option);
                const selectedAttribute = option === selectedValue ? ' selected' : '';
                return `<option value="${escapedOption}"${selectedAttribute}>${escapedOption}</option>`;
            })
            .join('');

        return `<select class="${escapedClassName}" data-parameter-key="${escapeHtml(key)}">${optionHtml}</select>`;
    }

    function createFixedValueInputHtml(param, key, currentValue = '') {
        return createValueSetInputHtml(param, key, currentValue, 'param-fixed-value', 'Fixed value');
    }

    function normalizeParameterDirection(value) {
        const normalized = String(value ?? '').trim().toLowerCase();

        if (!normalized) {
            return 'unknown';
        }

        if (['yes', 'true', '1', 'in', 'input'].includes(normalized)) {
            return 'input';
        }

        if (['no', 'false', '0', 'out', 'output'].includes(normalized)) {
            return 'output';
        }

        return 'unknown';
    }

    function isOutputParameter(param) {
        return normalizeParameterDirection(param?.input) === 'output';
    }

    function setMetadataStatus(message, isError = false) {
        const status = document.getElementById('metadataParametersStatus');
        if (!status) {
            return;
        }

        status.textContent = message || '';
        status.classList.toggle('error', Boolean(isError));
    }

    function setNodeStatus(message, isError = false) {
        const status = document.getElementById('nodeParametersStatus');
        if (!status) {
            return;
        }

        status.textContent = message || '';
        status.classList.toggle('error', Boolean(isError));
    }

    function applyNodeParameterDisplayNamesToCanvas(nodeId, savedParameters) {
        if (!nodeId || !savedParameters || typeof savedParameters !== 'object') {
            return;
        }

        const node = cy.$(`#${nodeId}`);
        if (!node || node.length === 0) {
            return;
        }

        node.data('savedParameters', savedParameters);

        const nodeParams = node.data('parameters') || {};
        const wrapper = cyContainer.querySelector(`[data-node-id="${nodeId}"]`);
        if (!wrapper) {
            return;
        }

        Object.entries(savedParameters).forEach(([key, value]) => {
            const paramMeta = nodeParams[key];
            if (!paramMeta || typeof paramMeta !== 'object') {
                return;
            }

            const rowIndex = String(paramMeta.index ?? '');
            let row = wrapper.querySelector(`tr[data-param-key="${key}"]`);
            if (!row && rowIndex) {
                row = wrapper.querySelector(`tr[data-param-index="${rowIndex}"]`);
            }
            if (!row) {
                return;
            }

            const cells = row.querySelectorAll('td');
            if (cells.length < 4) {
                return;
            }

            const displayName = (value && typeof value === 'object') ? String(value.display_name || '').trim() : '';
            cells[2].textContent = displayName || getParameterUiName(paramMeta, key);

            const fixedValue = (value && typeof value === 'object') ? String(value.fixed_value || '') : '';
            if (isOutputParameter(paramMeta)) {
                cells[3].textContent = '';
            } else if (fixedValue !== '') {
                cells[3].textContent = fixedValue;
            } else {
                const currentSource = String(cells[3].textContent || '').trim();
                if (!currentSource || currentSource === '...') {
                    cells[3].textContent = '...';
                }
            }
        });

        const updatedTable = wrapper.querySelector('table');
        if (updatedTable) {
            node.data('tableHtml', updatedTable.outerHTML);
        }
    }

    function applyNodeDisplayNameToCanvas(nodeId, savedNodeDisplayName) {
        if (!nodeId) {
            return;
        }

        const node = cy.$(`#${nodeId}`);
        if (!node || node.length === 0) {
            return;
        }

        const nextName = String(savedNodeDisplayName || '').trim();
        if (nextName) {
            node.data('name', nextName);
        }

        const wrapper = cyContainer.querySelector(`[data-node-id="${nodeId}"]`);
        if (!wrapper) {
            return;
        }

        const headerCell = wrapper.querySelector('tr.header td');
        if (headerCell) {
            headerCell.textContent = WorkflowApp.getNodeHeaderText({
                id: node.id(),
                name: node.data('name') || ''
            });
        }

        const updatedTable = wrapper.querySelector('table');
        if (updatedTable) {
            node.data('tableHtml', updatedTable.outerHTML);
        }
    }

    async function saveNodeParameters() {
        const container = document.getElementById('parametersContainer');
        const saveButton = document.getElementById('nodeParametersSetButton');

        if (!container || !saveButton) {
            return;
        }

        const nodeId = container.dataset.nodeId || '';
        const nodeDisplayName = document.getElementById('displayNameInput')?.value || '';
        const values = {};

        const displayInputs = Array.from(container.querySelectorAll('.param-display-name'));
        displayInputs.forEach((displayInput) => {
            const key = displayInput.dataset.parameterKey;
            if (!key) {
                return;
            }
            const fixedInput = container.querySelector(`.param-fixed-value[data-parameter-key="${key}"]`);
            values[key] = {
                display_name: displayInput.value || '',
                fixed_value: fixedInput ? (fixedInput.value || '') : ''
            };
        });

        saveButton.disabled = true;
        setNodeStatus('Saving...');

        try {
            const response = await fetch('/api/node-parameters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow_id: WorkflowApp.state.workflow_id,
                    node_id: nodeId,
                    node_display_name: nodeDisplayName,
                    parameters: values,
                    action: 'fixed'
                })
            });

            const data = await response.json();

            if (!response.ok || data.status !== 'success') {
                throw new Error(data.message || 'Failed to save node parameters');
            }

            applyNodeDisplayNameToCanvas(nodeId, data?.node_parameters?.node_display_name || nodeDisplayName);
            applyNodeParameterDisplayNamesToCanvas(nodeId, data?.node_parameters?.parameters || values);

            setNodeStatus('Saved');
        } catch (error) {
            console.error('Error saving node parameters:', error);
            setNodeStatus(error.message || 'Failed to save', true);
        } finally {
            saveButton.disabled = false;
        }
    }

    async function saveMetadataParameters() {
        const container = document.getElementById('metadataParametersContainer');
        const saveButton = document.getElementById('metadataParametersSetButton');

        if (!container || !saveButton) {
            return;
        }

        const inputs = Array.from(container.querySelectorAll('.metadata-parameter-input'));
        const values = {};

        inputs.forEach((input) => {
            values[input.dataset.parameterKey] = input.value;
        });

        saveButton.disabled = true;
        setMetadataStatus('Saving...');

        try {
            const response = await fetch('/api/metadata-parameters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow_id: WorkflowApp.state.workflow_id,
                    values: values
                })
            });

            const data = await response.json();

            if (!response.ok || data.status !== 'success') {
                throw new Error(data.message || 'Failed to save metadata parameters');
            }

            WorkflowApp.state.metadataParameterValues = data?.parameter_values && typeof data.parameter_values === 'object'
                ? data.parameter_values
                : values;
            setMetadataStatus('Saved');
        } catch (error) {
            console.error('Error saving metadata parameters:', error);
            setMetadataStatus(error.message || 'Failed to save', true);
        } finally {
            saveButton.disabled = false;
        }
    }

    function displayMetadataParameters(parameters, currentValues = {}) {
        const container = document.getElementById('metadataParametersContainer');

        if (!container) {
            return;
        }

        container.innerHTML = '';

        if (!parameters || typeof parameters !== 'object' || Object.keys(parameters).length === 0) {
            WorkflowApp.state.metadataParameterValues = {};
            container.innerHTML = '<p class="empty-state-text">No metadata available</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'parameters-table metadata-parameters-table';

        const thead = document.createElement('thead');
        thead.innerHTML = '<tr class="parameters-table-header-row"><th class="parameters-table-heading">Name</th><th class="parameters-table-heading">Type</th><th class="parameters-table-heading">Value</th></tr>';
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        Object.entries(parameters)
            .sort(([, leftParam], [, rightParam]) => {
                const leftIsOutput = isOutputParameter(leftParam);
                const rightIsOutput = isOutputParameter(rightParam);

                if (leftIsOutput !== rightIsOutput) {
                    return leftIsOutput ? 1 : -1;
                }

                const leftIndex = Number(leftParam?.index ?? Number.MAX_SAFE_INTEGER);
                const rightIndex = Number(rightParam?.index ?? Number.MAX_SAFE_INTEGER);
                return leftIndex - rightIndex;
            })
            .forEach(([key, param]) => {
                if (!param || typeof param !== 'object') {
                    return;
                }

                const row = document.createElement('tr');
                row.className = 'parameters-table-row';
                if (isOutputParameter(param)) {
                    row.classList.add('metadata-output-row');
                }

                const nameCell = document.createElement('td');
                nameCell.className = 'parameters-table-cell';
                nameCell.textContent = getParameterUiName(param, key);

                const typeCell = document.createElement('td');
                typeCell.className = 'parameters-table-cell metadata-parameter-type-cell';
                const paramType = param.type || '?';
                typeCell.innerHTML = getIconHtml(paramType);

                const valueCell = document.createElement('td');
                valueCell.className = 'parameters-table-cell';
                valueCell.innerHTML = createValueSetInputHtml(
                    param,
                    key,
                    currentValues[key] || '',
                    'metadata-parameter-input',
                    'Enter value'
                );
                const input = valueCell.querySelector('.metadata-parameter-input');
                if (input) {
                    input.dataset.parameterKey = key;
                    input.dataset.parameterIndex = String(param.index ?? '');
                    input.dataset.parameterInput = String(param.input ?? '');
                }

                row.appendChild(nameCell);
                row.appendChild(typeCell);
                row.appendChild(valueCell);
                tbody.appendChild(row);
            });

        if (tbody.children.length === 0) {
            container.innerHTML = '<p class="empty-state-text">No metadata available</p>';
            return;
        }

        table.appendChild(tbody);
        container.appendChild(table);

        const actions = document.createElement('div');
        actions.className = 'metadata-parameters-actions';

        const status = document.createElement('span');
        status.id = 'metadataParametersStatus';
        status.className = 'metadata-parameters-status';

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'metadataParametersSetButton';
        button.className = 'set-button';
        button.textContent = 'Set';
        button.addEventListener('click', saveMetadataParameters);

        actions.appendChild(status);
        actions.appendChild(button);
        container.appendChild(actions);
    }

    async function displayNodeParameters(node) {
        await ensureIconsLoaded();
        const parametersContainer = document.getElementById('parametersContainer');
        const titleElem = document.getElementById('parametersTitle');
        const displayInput = document.getElementById('displayNameInput');
        const nodeId = node.id();
        const nodeData = node.data();
        const savedParameters = (nodeData.savedParameters && typeof nodeData.savedParameters === 'object')
            ? nodeData.savedParameters
            : {};

        parametersContainer.dataset.nodeId = nodeId;

        // set title and input
        titleElem.textContent = nodeData.name || nodeId;
        displayInput.value = nodeData.name || '';

        if (!nodeData.parameters || Object.keys(nodeData.parameters).length === 0) {
            parametersContainer.innerHTML = '<p class="empty-state-text">No parameters available</p>';
            return;
        }

        let html = '<table class="parameters-table">';
        html += '<tr class="parameters-table-header-row"><th class="parameters-table-heading">Name</th><th class="parameters-table-heading">Type</th><th class="parameters-table-heading">Display&nbsp;Name</th><th class="parameters-table-heading">Fixed&nbsp;Value</th></tr>';
        let rowCount = 0;

        for (const [key, param] of Object.entries(nodeData.parameters)) {
            if (typeof param === 'object' && (param.UIname || param.UIName || param.name)) {
                const uiName = getParameterUiName(param, key);
                const paramType = param.type || '?';
                const iconHtml = getIconHtml(paramType);
                const savedParam = (savedParameters[key] && typeof savedParameters[key] === 'object')
                    ? savedParameters[key]
                    : {};
                const savedDisplayName = String(savedParam.display_name || '');
                const savedFixedValue = String(savedParam.fixed_value || '');
                const fixedValueInputHtml = createFixedValueInputHtml(param, key, savedFixedValue);
                html += `<tr class="parameters-table-row">
                        <td class="parameters-table-cell">${uiName}</td>
                        <td class="parameters-table-cell">${iconHtml}</td>
                        <td class="parameters-table-cell"><input type="text" class="param-display-name" data-parameter-key="${key}" value="${escapeHtml(savedDisplayName)}" placeholder="Display name" /></td>
                        <td class="parameters-table-cell">${fixedValueInputHtml}</td>
                    </tr>`;
                rowCount += 1;
            }
        }

        if (rowCount === 0) {
            parametersContainer.innerHTML = '<p class="empty-state-text">No parameters available</p>';
            return;
        }

        html += '</table>';
        // add set button below table
        html += '<div class="metadata-parameters-actions"><span id="nodeParametersStatus" class="metadata-parameters-status"></span><button type="button" id="nodeParametersSetButton" class="set-button">Set</button></div>';
        parametersContainer.innerHTML = html;

        const setButton = document.getElementById('nodeParametersSetButton');
        if (setButton) {
            setButton.addEventListener('click', saveNodeParameters);
        }
    }

    // Draggable resize handle between main area and bottom bar
    (function () {
        const handle = document.getElementById('resizeHandle');
        const HANDLE_PX = 6;
        const MIN_BOTTOM = 60;
        const MIN_TOP = 80;
        let dragging = false;
        let startY = 0;
        let startBottomPx = 0;

        handle.addEventListener('mousedown', function (e) {
            dragging = true;
            startY = e.clientY;
            // measure the current bottom-bar pixel height
            startBottomPx = document.getElementById('bottomBar').getBoundingClientRect().height;
            handle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            // dragging UP  (e.clientY < startY) → delta > 0 → bottom panel grows
            // dragging DOWN (e.clientY > startY) → delta < 0 → bottom panel shrinks
            const delta = startY - e.clientY;
            const totalHeight = window.innerHeight;
            let newBottomPx = startBottomPx + delta;
            newBottomPx = Math.max(MIN_BOTTOM, newBottomPx);
            newBottomPx = Math.min(newBottomPx, totalHeight - HANDLE_PX - MIN_TOP);
            document.body.style.gridTemplateRows = `1fr ${HANDLE_PX}px ${newBottomPx}px`;
            if (typeof cy !== 'undefined') cy.resize();
        });

        document.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    })();

    ensureIconsLoaded();

    // Toggle connection mode

    Object.assign(WorkflowApp, {
        ensureIconsLoaded,
        getIconHtml,
        getParameterUiName,
        escapeHtml,
        parseParameterValueSet,
        createValueSetInputHtml,
        createFixedValueInputHtml,
        normalizeParameterDirection,
        isOutputParameter,
        setMetadataStatus,
        setNodeStatus,
        applyNodeParameterDisplayNamesToCanvas,
        applyNodeDisplayNameToCanvas,
        saveNodeParameters,
        saveMetadataParameters,
        displayMetadataParameters,
        displayNodeParameters
    });
})();
