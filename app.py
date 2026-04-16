from flask import Flask, render_template, Response, request, jsonify
from flask_restful import Api, Resource
import ilwis
import json
import os
import pathlib
import uuid

workflow_id = -1
workflow_parameter_values = {}
workflow_node_parameter_values = {}

ICONS = {
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
}

def get_metadata(id):
    ##id = ilwis.operationMetaData(operation_name,  'id',workflow_id, '')
    metadata = ilwis.operationMetaData(id)
        
    # Parse metadata string: key/value pairs separated by '@'
    metadata_dict = {}
    if metadata:
        try:
            metadata_dict = json.loads(metadata)
        except json.JSONDecodeError:
            print(f"Error: Could not parse metadata as JSON: {metadata}")
    return metadata_dict

def get_icon(datatype): 
    icons = ICONS
    
    # If datatype contains pipe-separated types, return a list of icons (filtering out '?')
    if '|' in datatype:
        types = []
        for t in datatype.split('|'):      
            if t.strip() and t.strip() != '?':
               if t.strip() in icons:
                types.append(t.strip())
        #types = [t.strip() for t in datatype.split('|') if t.strip() and t.strip() != '?']
  
        if not types:  # If all types were '?', return None
            return None
        types = list(set(types))        
        all =  [icons.get(t, icons['unknown']) for t in types]
        all_red = list(set(all))   
        return all_red
    
    # If single type is '?', return None
    if datatype == '?':
        return None
    
    # Otherwise return a single icon string
    return icons.get(datatype, icons['unknown'])

                
app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')
app.secret_key = 'your-secret-key-change-this'  # Change this to a secure secret key

api = Api(app)

# Global dictionary to couple session_id with workflow_id


@app.route('/')
def index():
    return render_template('index.html')

class DataResource(Resource):
    def get(self):
       html = render_template('index.html')
       return Response(html, mimetype='text/html')

api.add_resource(DataResource, '/api/data')

@app.route('/api/sidebar', methods=['GET'])
def get_sidebar_items():
    """Endpoint to return sidebar items"""
    items = ilwis.operations("unique")
    return jsonify({'items': items})


@app.route('/api/icons', methods=['GET'])
def get_icons():
    """Endpoint to return icon mappings for datatypes"""
    return jsonify({'icons': ICONS})

@app.route('/api/workflow-id', methods=['GET'])
def get_workflow_id():
    global workflow_id
    
    if workflow_id == -1:
        resp = ilwis.updateWorkflow('{"workflow_id" : -1, "action" : "create" }')
        metadata_dict = json.loads(resp)
        workflow_id = metadata_dict.get('workflow_id', -1)

    return jsonify({'workflow_id': workflow_id})


@app.route('/api/metadata-parameters', methods=['POST'])
def set_metadata_parameters():
    data = request.get_json() or {}
    current_workflow_id = data.get('workflow_id', workflow_id)
    values = data.get('values', {})

    if current_workflow_id in (None, '', -1):
        return jsonify({'status': 'error', 'message': 'Invalid workflow id'}), 400

    if not isinstance(values, dict):
        return jsonify({'status': 'error', 'message': 'Parameter values must be an object'}), 400

    normalized_values = {}
    for key, value in values.items():
        normalized_values[str(key)] = '' if value is None else str(value)

    workflow_parameter_values[str(current_workflow_id)] = normalized_values

    return jsonify({
        'status': 'success',
        'message': 'Metadata parameter values saved',
        'workflow_id': current_workflow_id,
        'parameter_values': normalized_values
    })


@app.route('/api/node-parameters', methods=['POST'])
def set_node_parameters():
    data = request.get_json() or {}
    current_workflow_id = data.get('workflow_id', workflow_id)
    node_id = data.get('node_id')
    node_display_name = data.get('node_display_name', '')
    values = data.get('parameters', {})

    if current_workflow_id in (None, '', -1):
        return jsonify({'status': 'error', 'message': 'Invalid workflow id'}), 400

    if node_id in (None, ''):
        return jsonify({'status': 'error', 'message': 'Invalid node id'}), 400

    if not isinstance(values, dict):
        return jsonify({'status': 'error', 'message': 'Node parameters must be an object'}), 400

    normalized_values = {}
    for key, value in values.items():
        key_str = str(key)
        if isinstance(value, dict):
            normalized_values[key_str] = {
                'display_name': '' if value.get('display_name') is None else str(value.get('display_name')),
                'fixed_value': '' if value.get('fixed_value') is None else str(value.get('fixed_value'))
            }
        else:
            normalized_values[key_str] = {
                'display_name': '',
                'fixed_value': '' if value is None else str(value)
            }

    workflow_key = str(current_workflow_id)
    node_key = str(node_id)
    if workflow_key not in workflow_node_parameter_values:
        workflow_node_parameter_values[workflow_key] = {}

    workflow_node_parameter_values[workflow_key][node_key] = {
        'node_display_name': '' if node_display_name is None else str(node_display_name),
        'parameters': normalized_values
    }

    return jsonify({
        'status': 'success',
        'message': 'Node parameter values saved',
        'workflow_id': current_workflow_id,
        'node_id': node_id,
        'node_parameters': workflow_node_parameter_values[workflow_key][node_key]
    })
                    

@app.route('/api/node-table', methods=['POST'])
def generate_node_table():
    """Generate HTML table for a node"""
    data = request.get_json()
    node_data = data.get('node', {})
    
    if node_data.get('type') == 'operation':
        html = f"""<table class="node-table">
                <tr class="header"><td colspan="2">{node_data.get('name', 'Unknown')}</td></tr>
                <tr><td>CPU</td><td>{node_data.get('cpu', 'N/A')}</td></tr>
                <tr><td>RAM</td><td>{node_data.get('ram', 'N/A')}</td></tr>
            </table>"""
        return jsonify({'html': html.strip()})
    
    return jsonify({'html': ''})


@app.route('/api/drop', methods=['POST'])
def handle_drop():
    data = request.get_json()
    item = data.get('itemNumber')  # Support both 'itemNumber' and 'item' keys
    md = get_metadata(item)
    position = data.get('position')
    
    print(f"Dropped item: {item} at position {position}")
    
    # Use operation ID as initial node ID - unique ID will be assigned by updateWorkflow
    node_id = md['id']
    # Create node data to add to the graph
    node_data = {
        'node_id': node_id,
        'operation_id': md['id'],
        'name': md.get('name', item),
        'description': md.get('desc', 'No description available'),
        'type': 'operation',
        'x': position['x'],
        'y': position['y'],
        'parameters': md.get('parameters', {})  # Include parameters in node data
    }
    
    # Generate table HTML on server
    table_rows = f'<tr class="header"><td colspan="4">{node_data["name"]}</td></tr>'
    
    # Add parameter rows from metadata
    if 'parameters' in md and isinstance(md['parameters'], dict):
        for param_key, param_value in md['parameters'].items():
            if isinstance(param_value, dict) and 'name' in param_value:
                ui_name = param_value['name']
                index = param_value.get('index', '')
                param_type = param_value.get('type', '?')
                icon = get_icon(param_type)
                input = param_value.get('input', "yes")
                is_output = str(input).strip().lower() == 'no'
                input_source = '' if is_output else '...'
                type_cell_style = ' style="background-color: #e6e6e6;"' if is_output else ''
                # Create icon HTML - handle both single icon string and list of icons
                if icon is None:
                    icon_html = ''
                elif isinstance(icon, list):
                    icon_html = ''.join([f'<img src="/images/{ic}" style="width: 16px; height: 16px; margin-right: 2px;" />' for ic in icon])
                else:
                    icon_html = f'<img src="/images/{icon}" style="width: 16px; height: 16px;" />'
                       
                table_rows += f'\n                <tr data-param-key="{param_key}" data-param-index="{index}"><td{type_cell_style}>{index}</td><td{type_cell_style}>{icon_html}</td><td{type_cell_style}>{ui_name}</td><td{type_cell_style}>{input_source}</td></tr>'
    
    table_html = f"""<table class="node-table">
                {table_rows}
            </table>"""
    
    node_data['tableHtml'] = table_html
    
    response = {
        'status': 'success',
        'message': f'Node "{item}" added at position ({position["x"]}, {position["y"]})',
        'node': node_data
    }
    
    return jsonify(response)

@app.route('/api/graph', methods=['POST'])
def handle_graph_update():
    """Handle graph state updates from the client"""
    try:
        request_data = request.get_data(as_text=True)
        
        print(f"Graph update received:")
        print(f"  Graph data (string): {request_data}")
        
        p = ilwis.updateWorkflow(request_data)
        parsed_response = json.loads(p)
        md = get_metadata(str(workflow_id))
        
        response = {
            'status': 'success',
            'message': 'Graph state updated on server',
            'workflow_id': parsed_response.get('workflow_id', -1),
            'node_id': parsed_response.get('node_id', None),
            'metadata': md,
            'parameter_values': workflow_parameter_values.get(str(workflow_id), {}),

        }
        
        return jsonify(response)
    except Exception as e:
        print(f"Error processing graph update: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=5000)
