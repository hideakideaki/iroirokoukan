Attribute VB_Name = "FlowChartJsonImporter"
Option Explicit

' Required dependency:
' - Import JsonConverter.bas from VBA-JSON (https://github.com/VBA-tools/VBA-JSON)

Private Const PX_TO_PT As Double = 0.75

Public Sub ImportFlowChartFromJson()
    Dim filePath As String
    filePath = PickJsonFile()
    If Len(filePath) = 0 Then Exit Sub

    Dim jsonText As String
    jsonText = ReadAllText(filePath)
    If Len(jsonText) = 0 Then
        MsgBox "Failed to read JSON file.", vbExclamation
        Exit Sub
    End If

    Dim root As Object
    Set root = JsonConverter.ParseJson(jsonText)

    If Not root.Exists("nodes") Then
        MsgBox "nodes was not found in JSON.", vbExclamation
        Exit Sub
    End If

    Dim ws As Worksheet
    Set ws = ActiveSheet

    If MsgBox("Delete existing shapes before import?", vbYesNo + vbQuestion) = vbYes Then
        DeleteAllShapes ws
    End If

    Dim shapeMap As Object
    Set shapeMap = CreateObject("Scripting.Dictionary")

    CreateNodeShapes ws, root("nodes"), shapeMap

    If root.Exists("links") Then
        CreateLinkShapes ws, root("links"), shapeMap
    End If

    MsgBox "Import completed.", vbInformation
End Sub

Private Function PickJsonFile() As String
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = "Select FlowChart JSON"
        .AllowMultiSelect = False
        .Filters.Clear
        .Filters.Add "JSON", "*.json"
        If .Show <> -1 Then
            PickJsonFile = ""
            Exit Function
        End If
        PickJsonFile = .SelectedItems(1)
    End With
End Function

Private Function ReadAllText(ByVal filePath As String) As String
    On Error GoTo EH
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' text
    stm.Mode = 3 ' read/write
    stm.Charset = "utf-8"
    stm.Open
    stm.LoadFromFile filePath
    ReadAllText = stm.ReadText
    stm.Close

    ' Strip UTF-8 BOM if present.
    If Len(ReadAllText) > 0 Then
        If AscW(Left$(ReadAllText, 1)) = &HFEFF Then
            ReadAllText = Mid$(ReadAllText, 2)
        End If
    End If
    Exit Function
EH:
    ReadAllText = ""
End Function

Private Sub DeleteAllShapes(ByVal ws As Worksheet)
    Dim i As Long
    For i = ws.Shapes.Count To 1 Step -1
        ws.Shapes(i).Delete
    Next i
End Sub

Private Sub CreateNodeShapes(ByVal ws As Worksheet, ByVal nodes As Collection, ByVal shapeMap As Object)
    Dim n As Variant
    For Each n In nodes
        Dim id As String
        id = CStr(n("id"))

        Dim x As Double, y As Double, w As Double, h As Double
        x = CDbl(n("x")) * PX_TO_PT
        y = CDbl(n("y")) * PX_TO_PT
        w = CDbl(n("w")) * PX_TO_PT
        h = CDbl(n("h")) * PX_TO_PT

        Dim shapeType As Long
        shapeType = ExcelShapeType(CStr(n("type")))

        Dim shp As Shape
        If CStr(n("type")) = "text" Then
            Set shp = ws.Shapes.AddTextbox(msoTextOrientationHorizontal, x, y, w, h)
            shp.Line.Visible = msoFalse
            shp.Fill.Visible = msoFalse
        Else
            Set shp = ws.Shapes.AddShape(shapeType, x, y, w, h)
        End If

        shp.Name = "fc_node_" & id

        ApplyNodeStyle shp, n
        ApplyNodeText shp, n

        shapeMap.Add id, shp.Name
    Next n
End Sub

Private Sub ApplyNodeStyle(ByVal shp As Shape, ByVal node As Object)
    Dim nodeType As String
    nodeType = CStr(node("type"))

    If nodeType = "text" Then Exit Sub

    If node.Exists("color") Then
        Dim hexColor As String
        hexColor = CStr(node("color"))
        If LCase$(hexColor) = "transparent" Or Len(hexColor) = 0 Then
            shp.Fill.Visible = msoFalse
        Else
            shp.Fill.Visible = msoTrue
            shp.Fill.ForeColor.RGB = HexToRgb(hexColor)
        End If
    End If

    If nodeType = "dashed" Then
        shp.Line.Visible = msoTrue
        shp.Line.ForeColor.RGB = RGB(38, 70, 83)
        shp.Line.Weight = 1.5
        shp.Line.DashStyle = msoLineDash
        shp.Fill.Visible = msoFalse
    Else
        shp.Line.Visible = msoTrue
        shp.Line.ForeColor.RGB = RGB(38, 70, 83)
        shp.Line.Weight = 1.5
        shp.Line.DashStyle = msoLineSolid
    End If
End Sub

Private Sub ApplyNodeText(ByVal shp As Shape, ByVal node As Object)
    Dim labelText As String
    labelText = ""
    If node.Exists("label") Then labelText = CStr(node("label"))

    If Len(labelText) = 0 Then
        If shp.TextFrame2.HasText Then shp.TextFrame2.TextRange.Text = ""
        Exit Sub
    End If

    shp.TextFrame2.TextRange.Text = Replace(labelText, vbLf, vbCrLf)
    shp.TextFrame2.HorizontalAnchor = msoAnchorCenter
    shp.TextFrame2.VerticalAnchor = msoAnchorMiddle
    shp.TextFrame2.TextRange.ParagraphFormat.Alignment = msoAlignCenter
    shp.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(0, 0, 0)

    If node.Exists("fontSize") Then
        shp.TextFrame2.TextRange.Font.Size = CDbl(node("fontSize"))
    Else
        shp.TextFrame2.TextRange.Font.Size = 10
    End If
End Sub

Private Sub CreateLinkShapes(ByVal ws As Worksheet, ByVal links As Collection, ByVal shapeMap As Object)
    Dim l As Variant
    For Each l In links
        Dim fromId As String, toId As String
        fromId = CStr(l("from"))
        toId = CStr(l("to"))

        If Not shapeMap.Exists(fromId) Then GoTo ContinueLoop
        If Not shapeMap.Exists(toId) Then GoTo ContinueLoop

        Dim fromShape As Shape, toShape As Shape
        Set fromShape = ws.Shapes(shapeMap(fromId))
        Set toShape = ws.Shapes(shapeMap(toId))

        Dim fromSide As String, toSide As String
        fromSide = SideValue(l, "fromSide", "right")
        toSide = SideValue(l, "toSide", "left")

        Dim x1 As Double, y1 As Double, x2 As Double, y2 As Double
        x1 = SidePointX(fromShape, fromSide)
        y1 = SidePointY(fromShape, fromSide)
        x2 = SidePointX(toShape, toSide)
        y2 = SidePointY(toShape, toSide)

        Dim connectorType As MsoConnectorType
        connectorType = ConnectorStyleFromLink(l)

        Dim c As Shape
        Set c = ws.Shapes.AddConnector(connectorType, x1, y1, x2, y2)
        c.Name = "fc_link_" & CStr(l("id"))

        c.Line.ForeColor.RGB = RGB(42, 157, 143)
        c.Line.Weight = 1.5

        If LinkArrowEnabled(l) Then
            c.Line.EndArrowheadStyle = msoArrowheadTriangle
        Else
            c.Line.EndArrowheadStyle = msoArrowheadNone
        End If

        ' Do not use BeginConnect/EndConnect site indices.
        ' We place endpoints directly to match HTML side positions deterministically.

ContinueLoop:
    Next l
End Sub

Private Function SideValue(ByVal link As Object, ByVal keyName As String, ByVal fallback As String) As String
    If link.Exists(keyName) Then
        SideValue = LCase$(CStr(link(keyName)))
    Else
        SideValue = fallback
    End If
End Function

Private Function SidePointX(ByVal shp As Shape, ByVal sideName As String) As Double
    Select Case LCase$(sideName)
        Case "left"
            SidePointX = shp.Left
        Case "right"
            SidePointX = shp.Left + shp.Width
        Case "top", "bottom"
            SidePointX = shp.Left + shp.Width / 2
        Case Else
            SidePointX = shp.Left + shp.Width / 2
    End Select
End Function

Private Function SidePointY(ByVal shp As Shape, ByVal sideName As String) As Double
    Select Case LCase$(sideName)
        Case "top"
            SidePointY = shp.Top
        Case "bottom"
            SidePointY = shp.Top + shp.Height
        Case "left", "right"
            SidePointY = shp.Top + shp.Height / 2
        Case Else
            SidePointY = shp.Top + shp.Height / 2
    End Select
End Function

Private Function LinkArrowEnabled(ByVal link As Object) As Boolean
    If Not link.Exists("arrow") Then
        LinkArrowEnabled = True
        Exit Function
    End If

    Dim v As Variant
    v = link("arrow")
    Select Case VarType(v)
        Case vbBoolean
            LinkArrowEnabled = CBool(v)
        Case vbString
            LinkArrowEnabled = (LCase$(CStr(v)) = "true")
        Case vbInteger, vbLong, vbSingle, vbDouble
            LinkArrowEnabled = (CDbl(v) <> 0)
        Case Else
            LinkArrowEnabled = True
    End Select
End Function

Private Function ConnectorStyleFromLink(ByVal link As Object) As MsoConnectorType
    If Not link.Exists("style") Then
        ConnectorStyleFromLink = msoConnectorCurve
        Exit Function
    End If

    Select Case LCase$(CStr(link("style")))
        Case "straight"
            ConnectorStyleFromLink = msoConnectorStraight
        Case "orthogonal"
            ConnectorStyleFromLink = msoConnectorElbow
        Case Else
            ConnectorStyleFromLink = msoConnectorCurve
    End Select
End Function


Private Function ExcelShapeType(ByVal nodeType As String) As Long
    Select Case LCase$(nodeType)
        Case "start"
            ExcelShapeType = msoShapeFlowchartTerminator
        Case "process"
            ExcelShapeType = msoShapeFlowchartProcess
        Case "decision"
            ExcelShapeType = msoShapeFlowchartDecision
        Case "io"
            ExcelShapeType = msoShapeFlowchartData
        Case "dashed"
            ExcelShapeType = msoShapeRectangle
        Case Else
            ExcelShapeType = msoShapeRoundedRectangle
    End Select
End Function

Private Function HexToRgb(ByVal hexColor As String) As Long
    Dim s As String
    s = Replace(hexColor, "#", "")

    If Len(s) = 3 Then
        s = Mid$(s, 1, 1) & Mid$(s, 1, 1) & _
            Mid$(s, 2, 1) & Mid$(s, 2, 1) & _
            Mid$(s, 3, 1) & Mid$(s, 3, 1)
    End If

    If Len(s) <> 6 Then
        HexToRgb = RGB(255, 255, 255)
        Exit Function
    End If

    Dim r As Long, g As Long, b As Long
    r = CLng("&H" & Mid$(s, 1, 2))
    g = CLng("&H" & Mid$(s, 3, 2))
    b = CLng("&H" & Mid$(s, 5, 2))
    HexToRgb = RGB(r, g, b)
End Function
